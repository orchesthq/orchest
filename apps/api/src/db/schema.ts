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
  persona_key?: string | null;
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

export type SlackInstallationRow = {
  id: string;
  client_id: string;
  team_id: string;
  bot_key?: string;
  api_app_id?: string | null;
  team_name: string | null;
  enterprise_id: string | null;
  bot_user_id: string;
  bot_access_token: string;
  installed_by_user_id: string;
  installed_at: string;
  created_at: string;
};

export type SlackOauthStateRow = {
  state: string;
  client_id: string;
  bot_key?: string;
  agent_id?: string | null;
  created_at: string;
  expires_at: string;
};

export type SlackAgentLinkRow = {
  id: string;
  client_id: string;
  agent_id: string;
  team_id: string;
  bot_key?: string;
  dm_channel_id: string | null;
  display_name: string;
  icon_url: string | null;
  created_at: string;
};

export type GitHubInstallationRow = {
  id: string;
  client_id: string;
  installation_id: number;
  owner_login: string;
  access_token: string;
  token_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GitHubAgentConnectionRow = {
  id: string;
  agent_id: string;
  github_installation_id: string;
  commit_author_name: string;
  commit_author_email: string;
  access_level: "read" | "pr_only" | "direct_push";
  default_branch: string;
  default_repo: string;
  created_at: string;
  updated_at: string;
};

export type PartnerSettingRow = {
  id: string;
  partner: string;
  key: string;
  settings: unknown;
  created_at: string;
  updated_at: string;
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

export async function getPartnerSetting(input: {
  partner: string;
  key?: string;
}): Promise<PartnerSettingRow | null> {
  const partner = input.partner.trim();
  const key = (input.key ?? "default").trim();
  if (!partner) throw new Error("partner is required");
  if (!key) throw new Error("key is required");

  const { rows } = await query<PartnerSettingRow>(
    [
      "select id, partner, key, settings, created_at, updated_at",
      "from partner_settings",
      "where partner = $1 and key = $2",
      "limit 1",
    ].join("\n"),
    [partner, key]
  );
  return rows[0] ?? null;
}

export async function listPartnerSettingsByPartner(partnerRaw: string): Promise<PartnerSettingRow[]> {
  const partner = partnerRaw.trim();
  if (!partner) throw new Error("partner is required");

  const { rows } = await query<PartnerSettingRow>(
    [
      "select id, partner, key, settings, created_at, updated_at",
      "from partner_settings",
      "where partner = $1",
      "order by key asc",
    ].join("\n"),
    [partner]
  );
  return rows;
}

export async function upsertPartnerSetting(input: {
  partner: string;
  key?: string;
  settings: unknown;
}): Promise<PartnerSettingRow> {
  const partner = input.partner.trim();
  const key = (input.key ?? "default").trim();
  if (!partner) throw new Error("partner is required");
  if (!key) throw new Error("key is required");

  const settingsJson = JSON.stringify(input.settings ?? {});
  const { rows } = await query<PartnerSettingRow>(
    [
      "insert into partner_settings (partner, key, settings)",
      "values ($1, $2, $3::jsonb)",
      "on conflict (partner, key) do update set",
      "  settings = excluded.settings,",
      "  updated_at = now()",
      "returning id, partner, key, settings, created_at, updated_at",
    ].join("\n"),
    [partner, key, settingsJson]
  );
  return one(rows, "Failed to upsert partner setting");
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
      "select a.id, a.client_id, a.persona_key, a.name, a.role, a.system_prompt, a.created_at",
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
      "select id, client_id, persona_key, name, role, system_prompt, created_at",
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
  personaKey?: string | null;
  name: string;
  role: string;
  systemPrompt: string;
}): Promise<AgentRow> {
  assertUuid(input.clientId, "clientId");
  const { rows } = await query<AgentRow>(
    [
      "insert into agents (client_id, persona_key, name, role, system_prompt)",
      "values ($1, $2, $3, $4, $5)",
      "returning id, client_id, persona_key, name, role, system_prompt, created_at",
    ].join("\n"),
    [input.clientId, input.personaKey ?? null, input.name, input.role, input.systemPrompt]
  );
  return one(rows, "Failed to create agent");
}

export async function updateAgentScoped(input: {
  clientId: string;
  agentId: string;
  name?: string;
  role?: string;
  systemPrompt?: string;
}): Promise<AgentRow> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.agentId, "agentId");

  const { rows } = await query<AgentRow>(
    [
      "update agents",
      "set",
      "  name = coalesce($3, name),",
      "  role = coalesce($4, role),",
      "  system_prompt = coalesce($5, system_prompt)",
      "where client_id = $1 and id = $2",
      "returning id, client_id, persona_key, name, role, system_prompt, created_at",
    ].join("\n"),
    [input.clientId, input.agentId, input.name ?? null, input.role ?? null, input.systemPrompt ?? null]
  );
  return one(rows, "Agent not found for client (cannot update)");
}

export async function deleteAgentScoped(input: {
  clientId: string;
  agentId: string;
}): Promise<void> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.agentId, "agentId");

  const { rows } = await query(
    "delete from agents where client_id = $1 and id = $2 returning id",
    [input.clientId, input.agentId]
  );
  if (rows.length === 0) throw new Error("Agent not found for client (cannot delete)");
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
    name: agentName ?? "AI Software Engineer",
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

export async function createSlackOauthState(input: {
  clientId: string;
  state: string;
  botKey: string;
  agentId?: string | null;
  expiresAt: Date;
}): Promise<void> {
  assertUuid(input.clientId, "clientId");
  if (input.agentId) assertUuid(input.agentId, "agentId");
  await query(
    [
      "insert into slack_oauth_states (state, client_id, bot_key, agent_id, expires_at)",
      "values ($1, $2, $3, $4, $5)",
    ].join("\n"),
    [input.state, input.clientId, input.botKey, input.agentId ?? null, input.expiresAt.toISOString()]
  );
}

export async function consumeSlackOauthState(state: string): Promise<SlackOauthStateRow | null> {
  const { rows } = await query<SlackOauthStateRow>(
    [
      "delete from slack_oauth_states",
      "where state = $1 and expires_at > now()",
      "returning state, client_id, bot_key, agent_id, created_at, expires_at",
    ].join("\n"),
    [state]
  );
  return rows[0] ?? null;
}

export async function upsertSlackInstallation(input: {
  clientId: string;
  botKey: string;
  teamId: string;
  apiAppId?: string | null;
  teamName?: string | null;
  enterpriseId?: string | null;
  botUserId: string;
  botAccessToken: string;
  installedByUserId: string;
}): Promise<SlackInstallationRow> {
  assertUuid(input.clientId, "clientId");
  const { rows } = await query<SlackInstallationRow>(
    [
      "insert into slack_installations (client_id, team_id, bot_key, api_app_id, team_name, enterprise_id, bot_user_id, bot_access_token, installed_by_user_id)",
      "values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      "on conflict (team_id, bot_key) do update set",
      "  client_id = excluded.client_id,",
      "  api_app_id = excluded.api_app_id,",
      "  team_name = excluded.team_name,",
      "  enterprise_id = excluded.enterprise_id,",
      "  bot_user_id = excluded.bot_user_id,",
      "  bot_access_token = excluded.bot_access_token,",
      "  installed_by_user_id = excluded.installed_by_user_id,",
      "  installed_at = now()",
      "returning id, client_id, team_id, bot_key, api_app_id, team_name, enterprise_id, bot_user_id, bot_access_token, installed_by_user_id, installed_at, created_at",
    ].join("\n"),
    [
      input.clientId,
      input.teamId,
      input.botKey,
      input.apiAppId ?? null,
      input.teamName ?? null,
      input.enterpriseId ?? null,
      input.botUserId,
      input.botAccessToken,
      input.installedByUserId,
    ]
  );
  return one(rows, "Failed to upsert Slack installation");
}

export async function listSlackInstallationsByClientId(
  clientId: string
): Promise<SlackInstallationRow[]> {
  assertUuid(clientId, "clientId");
  const { rows } = await query<SlackInstallationRow>(
    [
      "select id, client_id, team_id, bot_key, api_app_id, team_name, enterprise_id, bot_user_id, bot_access_token, installed_by_user_id, installed_at, created_at",
      "from slack_installations",
      "where client_id = $1",
      "order by installed_at desc",
    ].join("\n"),
    [clientId]
  );
  return rows;
}

export async function getSlackInstallationByClientIdAndBotKey(input: {
  clientId: string;
  botKey: string;
}): Promise<SlackInstallationRow | null> {
  assertUuid(input.clientId, "clientId");
  const { rows } = await query<SlackInstallationRow>(
    [
      "select id, client_id, team_id, bot_key, api_app_id, team_name, enterprise_id, bot_user_id, bot_access_token, installed_by_user_id, installed_at, created_at",
      "from slack_installations",
      "where client_id = $1 and bot_key = $2",
      "order by installed_at desc",
      "limit 1",
    ].join("\n"),
    [input.clientId, input.botKey]
  );
  return rows[0] ?? null;
}

export async function deleteSlackInstallationsByClientIdAndBotKey(input: {
  clientId: string;
  botKey: string;
}): Promise<number> {
  assertUuid(input.clientId, "clientId");
  const { rows } = await query<{ id: string }>(
    "delete from slack_installations where client_id = $1 and bot_key = $2 returning id",
    [input.clientId, input.botKey]
  );
  return rows.length;
}

export async function deleteSlackAgentLinksByAgentIdScoped(input: {
  clientId: string;
  agentId: string;
}): Promise<number> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.agentId, "agentId");
  const { rows } = await query<{ id: string }>(
    "delete from slack_agent_links where client_id = $1 and agent_id = $2 returning id",
    [input.clientId, input.agentId]
  );
  return rows.length;
}

export async function countAgentsByPersonaKeyScoped(input: {
  clientId: string;
  personaKey: string;
  excludeAgentId?: string;
}): Promise<number> {
  assertUuid(input.clientId, "clientId");
  if (input.excludeAgentId) assertUuid(input.excludeAgentId, "excludeAgentId");
  const { rows } = await query<{ count: string }>(
    [
      "select count(*)::text as count",
      "from agents",
      "where client_id = $1 and persona_key = $2",
      input.excludeAgentId ? "  and id <> $3" : "",
    ].join("\n"),
    input.excludeAgentId ? [input.clientId, input.personaKey, input.excludeAgentId] : [input.clientId, input.personaKey]
  );
  return Number(rows[0]?.count ?? "0") || 0;
}

export async function getSlackInstallationByTeamIdAndApiAppId(input: {
  teamId: string;
  apiAppId: string;
}): Promise<SlackInstallationRow | null> {
  const { rows } = await query<SlackInstallationRow>(
    [
      "select id, client_id, team_id, bot_key, api_app_id, team_name, enterprise_id, bot_user_id, bot_access_token, installed_by_user_id, installed_at, created_at",
      "from slack_installations",
      "where team_id = $1 and api_app_id = $2",
      "limit 1",
    ].join("\n"),
    [input.teamId, input.apiAppId]
  );
  return rows[0] ?? null;
}

export async function upsertSlackAgentLink(input: {
  clientId: string;
  agentId: string;
  teamId: string;
  botKey: string;
  dmChannelId?: string | null;
  displayName: string;
  iconUrl?: string | null;
}): Promise<SlackAgentLinkRow> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.agentId, "agentId");
  const { rows } = await query<SlackAgentLinkRow>(
    [
      "insert into slack_agent_links (client_id, agent_id, team_id, bot_key, dm_channel_id, display_name, icon_url)",
      "values ($1, $2, $3, $4, $5, $6, $7)",
      "on conflict (team_id, agent_id, bot_key) do update set",
      "  dm_channel_id = coalesce(excluded.dm_channel_id, slack_agent_links.dm_channel_id),",
      "  display_name = excluded.display_name,",
      "  icon_url = excluded.icon_url",
      "returning id, client_id, agent_id, team_id, bot_key, dm_channel_id, display_name, icon_url, created_at",
    ].join("\n"),
    [
      input.clientId,
      input.agentId,
      input.teamId,
      input.botKey,
      input.dmChannelId ?? null,
      input.displayName,
      input.iconUrl ?? null,
    ]
  );
  return one(rows, "Failed to upsert Slack agent link");
}

export async function getSlackAgentLinkByDmChannelId(input: {
  teamId: string;
  botKey: string;
  dmChannelId: string;
}): Promise<SlackAgentLinkRow | null> {
  const { rows } = await query<SlackAgentLinkRow>(
    [
      "select id, client_id, agent_id, team_id, bot_key, dm_channel_id, display_name, icon_url, created_at",
      "from slack_agent_links",
      "where team_id = $1 and bot_key = $2 and dm_channel_id = $3",
      "limit 1",
    ].join("\n"),
    [input.teamId, input.botKey, input.dmChannelId]
  );
  return rows[0] ?? null;
}

export async function getSlackAgentLinkByAgentId(input: {
  clientId: string;
  agentId: string;
}): Promise<SlackAgentLinkRow | null> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.agentId, "agentId");

  // Prefer newest installation, but if multiple bots are connected we can't infer which
  // bot identity is used for this agent without an explicit botKey. Use the per-bot method
  // in the Slack internal routes.
  const installations = await listSlackInstallationsByClientId(input.clientId);
  const installation = installations[0];
  if (!installation) return null;

  const { rows } = await query<SlackAgentLinkRow>(
    [
      "select id, client_id, agent_id, team_id, bot_key, dm_channel_id, display_name, icon_url, created_at",
      "from slack_agent_links",
      "where client_id = $1 and agent_id = $2 and team_id = $3",
      "limit 1",
    ].join("\n"),
    [input.clientId, input.agentId, installation.team_id]
  );
  return rows[0] ?? null;
}

export async function getSlackAgentLinkByAgentIdAndBotKey(input: {
  clientId: string;
  agentId: string;
  botKey: string;
}): Promise<SlackAgentLinkRow | null> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.agentId, "agentId");

  const installation = await getSlackInstallationByClientIdAndBotKey({
    clientId: input.clientId,
    botKey: input.botKey,
  });
  if (!installation) return null;

  const { rows } = await query<SlackAgentLinkRow>(
    [
      "select id, client_id, agent_id, team_id, bot_key, dm_channel_id, display_name, icon_url, created_at",
      "from slack_agent_links",
      "where client_id = $1 and agent_id = $2 and team_id = $3 and bot_key = $4",
      "limit 1",
    ].join("\n"),
    [input.clientId, input.agentId, installation.team_id, input.botKey]
  );
  return rows[0] ?? null;
}

export async function getSlackAgentLinkByTeamAndBotKey(input: {
  teamId: string;
  botKey: string;
}): Promise<SlackAgentLinkRow | null> {
  const { rows } = await query<SlackAgentLinkRow>(
    [
      "select id, client_id, agent_id, team_id, bot_key, dm_channel_id, display_name, icon_url, created_at",
      "from slack_agent_links",
      "where team_id = $1 and bot_key = $2",
      "order by created_at desc",
      "limit 1",
    ].join("\n"),
    [input.teamId, input.botKey]
  );
  return rows[0] ?? null;
}

export async function ensureSlackDefaultTenant(): Promise<{
  client: ClientRow;
  agent: AgentRow;
}> {
  const defaultsSchema = z
    .object({
      defaultClientName: z.string().min(1).optional(),
      defaultAgentName: z.string().min(1).optional(),
    })
    .passthrough();
  const defaults = await getPartnerSetting({ partner: "slack", key: "defaults" }).catch(() => null);
  const parsedDefaults = defaultsSchema.safeParse(defaults?.settings ?? null);

  const clientName = parsedDefaults.success
    ? (parsedDefaults.data.defaultClientName ?? "Default Client")
    : "Default Client";
  const agentName = parsedDefaults.success
    ? (parsedDefaults.data.defaultAgentName ?? "AI Software Engineer")
    : "AI Software Engineer";

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

export async function getGitHubInstallationByClientId(
  clientId: string
): Promise<GitHubInstallationRow | null> {
  assertUuid(clientId, "clientId");
  const { rows } = await query<GitHubInstallationRow>(
    [
      "select id, client_id, installation_id, owner_login, access_token, token_expires_at, created_at, updated_at",
      "from github_installations",
      "where client_id = $1",
      "limit 1",
    ].join("\n"),
    [clientId]
  );
  return rows[0] ?? null;
}

export async function getGitHubInstallationById(
  id: string
): Promise<GitHubInstallationRow | null> {
  assertUuid(id, "id");
  const { rows } = await query<GitHubInstallationRow>(
    [
      "select id, client_id, installation_id, owner_login, access_token, token_expires_at, created_at, updated_at",
      "from github_installations",
      "where id = $1",
      "limit 1",
    ].join("\n"),
    [id]
  );
  return rows[0] ?? null;
}

export async function upsertGitHubInstallation(input: {
  clientId: string;
  installationId: number;
  ownerLogin: string;
  accessToken: string;
  tokenExpiresAt: Date | null;
}): Promise<GitHubInstallationRow> {
  assertUuid(input.clientId, "clientId");
  const { rows } = await query<GitHubInstallationRow>(
    [
      "insert into github_installations (client_id, installation_id, owner_login, access_token, token_expires_at, updated_at)",
      "values ($1, $2, $3, $4, $5, now())",
      "on conflict (client_id) do update set",
      "  installation_id = excluded.installation_id,",
      "  owner_login = excluded.owner_login,",
      "  access_token = excluded.access_token,",
      "  token_expires_at = excluded.token_expires_at,",
      "  updated_at = now()",
      "returning id, client_id, installation_id, owner_login, access_token, token_expires_at, created_at, updated_at",
    ].join("\n"),
    [
      input.clientId,
      input.installationId,
      input.ownerLogin,
      input.accessToken,
      input.tokenExpiresAt?.toISOString() ?? null,
    ]
  );
  return one(rows, "Failed to upsert GitHub installation");
}

export async function deleteGitHubInstallationByClientId(clientId: string): Promise<boolean> {
  assertUuid(clientId, "clientId");
  const { rows } = await query<{ id: string }>(
    "delete from github_installations where client_id = $1 returning id",
    [clientId]
  );
  return rows.length > 0;
}

export async function listGitHubAgentConnectionsByAgentId(
  agentId: string
): Promise<GitHubAgentConnectionRow[]> {
  assertUuid(agentId, "agentId");
  const { rows } = await query<GitHubAgentConnectionRow>(
    [
      "select id, agent_id, github_installation_id, commit_author_name, commit_author_email, access_level, default_branch, default_repo, created_at, updated_at",
      "from github_agent_connections",
      "where agent_id = $1",
    ].join("\n"),
    [agentId]
  );
  return rows;
}

export async function deleteGitHubAgentConnectionScoped(input: {
  clientId: string;
  agentId: string;
}): Promise<boolean> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.agentId, "agentId");

  const { rows } = await query<{ id: string }>(
    [
      "delete from github_agent_connections gac",
      "using agents a",
      "where a.id = gac.agent_id",
      "  and a.client_id = $1",
      "  and a.id = $2",
      "returning gac.id",
    ].join("\n"),
    [input.clientId, input.agentId]
  );
  return rows.length > 0;
}

export async function deleteGitHubAgentConnectionByIdScoped(input: {
  clientId: string;
  agentId?: string;
  connectionId: string;
}): Promise<boolean> {
  assertUuid(input.clientId, "clientId");
  if (input.agentId) assertUuid(input.agentId, "agentId");
  assertUuid(input.connectionId, "connectionId");

  const { rows } = await query<{ id: string }>(
    [
      "delete from github_agent_connections gac",
      "using agents a",
      "where a.id = gac.agent_id",
      "  and a.client_id = $1",
      "  and gac.id = $2",
      input.agentId ? "  and a.id = $3" : "",
      "returning gac.id",
    ].join("\n"),
    input.agentId ? [input.clientId, input.connectionId, input.agentId] : [input.clientId, input.connectionId]
  );
  return rows.length > 0;
}

export async function upsertGitHubAgentConnection(input: {
  agentId: string;
  githubInstallationId: string;
  commitAuthorName: string;
  commitAuthorEmail: string;
  accessLevel: "read" | "pr_only" | "direct_push";
  defaultBranch: string;
  defaultRepo: string;
}): Promise<GitHubAgentConnectionRow> {
  assertUuid(input.agentId, "agentId");
  assertUuid(input.githubInstallationId, "githubInstallationId");
  const { rows } = await query<GitHubAgentConnectionRow>(
    [
      "insert into github_agent_connections (agent_id, github_installation_id, commit_author_name, commit_author_email, access_level, default_branch, default_repo, updated_at)",
      "values ($1, $2, $3, $4, $5, $6, $7, now())",
      "on conflict (agent_id, default_repo) do update set",
      "  github_installation_id = excluded.github_installation_id,",
      "  commit_author_name = excluded.commit_author_name,",
      "  commit_author_email = excluded.commit_author_email,",
      "  access_level = excluded.access_level,",
      "  default_branch = excluded.default_branch,",
      "  default_repo = excluded.default_repo,",
      "  updated_at = now()",
      "returning id, agent_id, github_installation_id, commit_author_name, commit_author_email, access_level, default_branch, default_repo, created_at, updated_at",
    ].join("\n"),
    [
      input.agentId,
      input.githubInstallationId,
      input.commitAuthorName,
      input.commitAuthorEmail,
      input.accessLevel,
      input.defaultBranch,
      input.defaultRepo,
    ]
  );
  return one(rows, "Failed to upsert GitHub agent connection");
}

