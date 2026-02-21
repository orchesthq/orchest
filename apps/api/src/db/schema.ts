import { z } from "zod";
import { query } from "./client";

// DB access layer with multi-tenant safety:
// - All externally-called reads/writes take a `clientId` and enforce ownership in SQL (via `client_id`
//   predicates or tenant-safe `insert ... select` from `agents`).
// - The core agent loop loads task context (task + agent + client) in one join, then scopes follow-on
//   memory writes to that `clientId`.

const uuidSchema = z.string().uuid();

export const taskStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const memoryTypeSchema = z.enum(["profile", "episodic", "semantic"]);
export type MemoryType = z.infer<typeof memoryTypeSchema>;

export type ClientRow = {
  id: string;
  name: string;
  created_at: string;
};

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
};

export type ClientMembershipRow = {
  id: string;
  client_id: string;
  user_id: string;
  role: string;
  created_at: string;
};

export type AgentRow = {
  id: string;
  client_id: string;
  name: string;
  role: string;
  system_prompt: string;
  created_at: string;
};

export type TaskRow = {
  id: string;
  agent_id: string;
  status: TaskStatus;
  input: string;
  output: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentMemoryRow = {
  id: string;
  agent_id: string;
  memory_type: MemoryType;
  content: string;
  created_at: string;
};

export const DEFAULT_SOFTWARE_ENGINEER_SYSTEM_PROMPT =
  "You are an AI Software Engineer employed by the client. You complete software engineering tasks reliably, communicate clearly, and follow best practices.";

function assertUuid(id: string, label: string): void {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) throw new Error(`Invalid ${label} UUID: ${id}`);
}

function one<T>(rows: T[], message: string): T {
  const row = rows[0];
  if (!row) throw new Error(message);
  return row;
}

export async function getClientByName(name: string): Promise<ClientRow | null> {
  const { rows } = await query<ClientRow>(
    "select id, name, created_at from clients where name = $1 limit 1",
    [name]
  );
  return rows[0] ?? null;
}

export async function createClient(name: string): Promise<ClientRow> {
  const { rows } = await query<ClientRow>(
    "insert into clients (name) values ($1) returning id, name, created_at",
    [name]
  );
  return one(rows, "Failed to create client");
}

export async function getClientById(clientId: string): Promise<ClientRow | null> {
  assertUuid(clientId, "clientId");
  const { rows } = await query<ClientRow>(
    "select id, name, created_at from clients where id = $1 limit 1",
    [clientId]
  );
  return rows[0] ?? null;
}

export async function ensureClientByName(name: string): Promise<ClientRow> {
  const existing = await getClientByName(name);
  if (existing) return existing;
  return await createClient(name);
}

export async function getAgentByIdScoped(
  clientId: string,
  agentId: string
): Promise<AgentRow | null> {
  assertUuid(clientId, "clientId");
  assertUuid(agentId, "agentId");

  const { rows } = await query<AgentRow>(
    [
      "select a.id, a.client_id, a.name, a.role, a.system_prompt, a.created_at",
      "from agents a",
      "where a.id = $2 and a.client_id = $1",
      "limit 1",
    ].join("\n"),
    [clientId, agentId]
  );
  return rows[0] ?? null;
}

export async function listAgentsScoped(clientId: string): Promise<AgentRow[]> {
  assertUuid(clientId, "clientId");
  const { rows } = await query<AgentRow>(
    [
      "select id, client_id, name, role, system_prompt, created_at",
      "from agents",
      "where client_id = $1",
      "order by created_at asc",
    ].join("\n"),
    [clientId]
  );
  return rows;
}

export async function createAgent(input: {
  clientId: string;
  name: string;
  role: string;
  systemPrompt: string;
}): Promise<AgentRow> {
  assertUuid(input.clientId, "clientId");
  const { rows } = await query<AgentRow>(
    [
      "insert into agents (client_id, name, role, system_prompt)",
      "values ($1, $2, $3, $4)",
      "returning id, client_id, name, role, system_prompt, created_at",
    ].join("\n"),
    [input.clientId, input.name, input.role, input.systemPrompt]
  );
  return one(rows, "Failed to create agent");
}

export async function updateAgentScoped(input: {
  clientId: string;
  agentId: string;
  name?: string;
  systemPrompt?: string;
}): Promise<AgentRow> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.agentId, "agentId");

  const { rows } = await query<AgentRow>(
    [
      "update agents",
      "set",
      "  name = coalesce($3, name),",
      "  system_prompt = coalesce($4, system_prompt)",
      "where client_id = $1 and id = $2",
      "returning id, client_id, name, role, system_prompt, created_at",
    ].join("\n"),
    [input.clientId, input.agentId, input.name ?? null, input.systemPrompt ?? null]
  );
  return one(rows, "Agent not found for client (cannot update)");
}

export async function ensureDefaultAgentForClient(
  clientId: string,
  agentName?: string
): Promise<AgentRow> {
  assertUuid(clientId, "clientId");

  const desiredRole = "ai_software_engineer";
  const { rows: existing } = await query<AgentRow>(
    [
      "select id, client_id, name, role, system_prompt, created_at",
      "from agents",
      "where client_id = $1 and role = $2",
      "order by created_at asc",
      "limit 1",
    ].join("\n"),
    [clientId, desiredRole]
  );
  if (existing[0]) return existing[0];

  return await createAgent({
    clientId,
    name: agentName ?? process.env.DEFAULT_AGENT_NAME ?? "AI Software Engineer",
    role: desiredRole,
    systemPrompt: DEFAULT_SOFTWARE_ENGINEER_SYSTEM_PROMPT,
  });
}

export async function createClientMembership(input: {
  clientId: string;
  userId: string;
  role: string;
}): Promise<ClientMembershipRow> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.userId, "userId");

  const { rows } = await query<ClientMembershipRow>(
    [
      "insert into client_memberships (client_id, user_id, role)",
      "values ($1, $2, $3)",
      "returning id, client_id, user_id, role, created_at",
    ].join("\n"),
    [input.clientId, input.userId, input.role]
  );
  return one(rows, "Failed to create client membership");
}

export async function listClientMembershipsByUserId(userId: string): Promise<ClientMembershipRow[]> {
  assertUuid(userId, "userId");
  const { rows } = await query<ClientMembershipRow>(
    [
      "select id, client_id, user_id, role, created_at",
      "from client_memberships",
      "where user_id = $1",
      "order by created_at asc",
    ].join("\n"),
    [userId]
  );
  return rows;
}

export async function ensureSlackDefaultTenant(): Promise<{
  client: ClientRow;
  agent: AgentRow;
}> {
  const clientName = process.env.DEFAULT_CLIENT_NAME ?? "Default Client";
  const agentName = process.env.DEFAULT_AGENT_NAME ?? "AI Software Engineer";

  const client = await ensureClientByName(clientName);
  const agent = await ensureDefaultAgentForClient(client.id, agentName);
  return { client, agent };
}

export async function createTaskForAgentScoped(input: {
  clientId: string;
  agentId: string;
  taskInput: string;
}): Promise<TaskRow> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.agentId, "agentId");

  // Tenant-safe insert: only inserts if agent belongs to client.
  const { rows } = await query<TaskRow>(
    [
      "insert into tasks (agent_id, input)",
      "select a.id, $3",
      "from agents a",
      "where a.client_id = $1 and a.id = $2",
      "returning id, agent_id, status, input, output, created_at, updated_at",
    ].join("\n"),
    [input.clientId, input.agentId, input.taskInput]
  );

  return one(rows, "Agent not found for client (cannot create task)");
}

export type TaskContextRow = {
  task: TaskRow;
  agent: AgentRow;
  client: ClientRow;
};

export async function getTaskContextById(taskId: string): Promise<TaskContextRow> {
  assertUuid(taskId, "taskId");
  const { rows } = await query<{
    task_id: string;
    task_agent_id: string;
    task_status: TaskStatus;
    task_input: string;
    task_output: string | null;
    task_created_at: string;
    task_updated_at: string;
    agent_id: string;
    agent_client_id: string;
    agent_name: string;
    agent_role: string;
    agent_system_prompt: string;
    agent_created_at: string;
    client_id: string;
    client_name: string;
    client_created_at: string;
  }>(
    [
      "select",
      "  t.id as task_id, t.agent_id as task_agent_id, t.status as task_status,",
      "  t.input as task_input, t.output as task_output,",
      "  t.created_at as task_created_at, t.updated_at as task_updated_at,",
      "  a.id as agent_id, a.client_id as agent_client_id, a.name as agent_name,",
      "  a.role as agent_role, a.system_prompt as agent_system_prompt, a.created_at as agent_created_at,",
      "  c.id as client_id, c.name as client_name, c.created_at as client_created_at",
      "from tasks t",
      "join agents a on a.id = t.agent_id",
      "join clients c on c.id = a.client_id",
      "where t.id = $1",
      "limit 1",
    ].join("\n"),
    [taskId]
  );

  const r = one(rows, "Task not found");
  return {
    task: {
      id: r.task_id,
      agent_id: r.task_agent_id,
      status: r.task_status,
      input: r.task_input,
      output: r.task_output,
      created_at: r.task_created_at,
      updated_at: r.task_updated_at,
    },
    agent: {
      id: r.agent_id,
      client_id: r.agent_client_id,
      name: r.agent_name,
      role: r.agent_role,
      system_prompt: r.agent_system_prompt,
      created_at: r.agent_created_at,
    },
    client: {
      id: r.client_id,
      name: r.client_name,
      created_at: r.client_created_at,
    },
  };
}

export async function getTaskByIdScoped(
  clientId: string,
  taskId: string
): Promise<TaskRow | null> {
  assertUuid(clientId, "clientId");
  assertUuid(taskId, "taskId");

  const { rows } = await query<TaskRow>(
    [
      "select t.id, t.agent_id, t.status, t.input, t.output, t.created_at, t.updated_at",
      "from tasks t",
      "join agents a on a.id = t.agent_id",
      "where t.id = $2 and a.client_id = $1",
      "limit 1",
    ].join("\n"),
    [clientId, taskId]
  );
  return rows[0] ?? null;
}

export async function updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
  assertUuid(taskId, "taskId");
  await query("update tasks set status = $2 where id = $1", [taskId, status]);
}

export async function completeTask(taskId: string, output: string): Promise<void> {
  assertUuid(taskId, "taskId");
  await query("update tasks set status = 'completed', output = $2 where id = $1", [
    taskId,
    output,
  ]);
}

export async function failTask(taskId: string, output: string): Promise<void> {
  assertUuid(taskId, "taskId");
  await query("update tasks set status = 'failed', output = $2 where id = $1", [
    taskId,
    output,
  ]);
}

export async function listAgentMemoriesScoped(input: {
  clientId: string;
  agentId: string;
  limit?: number;
}): Promise<AgentMemoryRow[]> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.agentId, "agentId");
  const limit = input.limit ?? 50;

  const { rows } = await query<AgentMemoryRow>(
    [
      "select m.id, m.agent_id, m.memory_type, m.content, m.created_at",
      "from agent_memories m",
      "join agents a on a.id = m.agent_id",
      "where a.client_id = $1 and m.agent_id = $2",
      "order by m.created_at desc",
      "limit $3",
    ].join("\n"),
    [input.clientId, input.agentId, limit]
  );
  return rows;
}

export async function listAgentMemoriesByTypeScoped(input: {
  clientId: string;
  agentId: string;
  memoryType: MemoryType;
  limit?: number;
}): Promise<AgentMemoryRow[]> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.agentId, "agentId");
  const limit = input.limit ?? 50;

  const { rows } = await query<AgentMemoryRow>(
    [
      "select m.id, m.agent_id, m.memory_type, m.content, m.created_at",
      "from agent_memories m",
      "join agents a on a.id = m.agent_id",
      "where a.client_id = $1 and m.agent_id = $2 and m.memory_type = $3",
      "order by m.created_at desc",
      "limit $4",
    ].join("\n"),
    [input.clientId, input.agentId, input.memoryType, limit]
  );
  return rows;
}

export async function addAgentMemoryScoped(input: {
  clientId: string;
  agentId: string;
  memoryType: MemoryType;
  content: string;
}): Promise<AgentMemoryRow> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.agentId, "agentId");

  // Tenant-safe insert: only inserts if agent belongs to client.
  const { rows } = await query<AgentMemoryRow>(
    [
      "insert into agent_memories (agent_id, memory_type, content)",
      "select a.id, $3, $4",
      "from agents a",
      "where a.client_id = $1 and a.id = $2",
      "returning id, agent_id, memory_type, content, created_at",
    ].join("\n"),
    [input.clientId, input.agentId, input.memoryType, input.content]
  );

  return one(rows, "Agent not found for client (cannot add memory)");
}

