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

export type TokenUsageEventRow = {
  id: string;
  client_id: string;
  agent_id: string | null;
  task_id: string | null;
  provider: string;
  model: string;
  operation: string;
  prompt_tokens: number;
  completion_tokens: number;
  cached_prompt_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  input_cost_usd_micros?: number | null;
  cached_input_cost_usd_micros?: number | null;
  output_cost_usd_micros?: number | null;
  total_cost_usd_micros?: number | null;
  markup_multiplier_snapshot?: string | null;
  billable_usd_micros?: number | null;
  pricing_version?: string | null;
  provider_request_id: string | null;
  metadata: unknown;
  occurred_at: string;
  created_at: string;
};

export type TokenLedgerEntryType =
  | "grant"
  | "topup"
  | "subscription_allocation"
  | "usage_debit"
  | "adjustment";

export type TokenLedgerEntryRow = {
  id: string;
  client_id: string;
  entry_type: TokenLedgerEntryType;
  tokens: number;
  reference_type: string | null;
  reference_id: string | null;
  note: string | null;
  metadata: unknown;
  created_by_user_id: string | null;
  created_at: string;
};

export type LlmPricingTokenType = "input" | "cached_input" | "output";

export type LlmPricingRateRow = {
  id: string;
  provider: string;
  model: string;
  operation: string;
  token_type: LlmPricingTokenType;
  usd_per_1m_tokens: string;
  pricing_version: string;
  effective_from: string;
  effective_to: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type ClientBillingProfileRow = {
  client_id: string;
  markup_multiplier: string;
  free_monthly_usd_micros: string;
  billing_mode: "usd_credits";
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

export type KbSourceRow = {
  id: string;
  client_id: string;
  provider: "github";
  repo_full_name: string;
  ref: string;
  last_synced_sha: string | null;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
};

export type KbChunkRow = {
  id: string;
  client_id: string;
  source_id: string;
  path: string;
  start_line: number;
  end_line: number;
  content: string;
  content_hash: string;
  symbol?: string | null;
  kind?: string | null;
  language?: string | null;
  token_count: number | null;
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

export async function upsertKbSource(input: {
  clientId: string;
  provider: "github";
  repoFullName: string;
  ref: string;
  lastSyncedSha?: string | null;
}): Promise<KbSourceRow> {
  assertUuid(input.clientId, "clientId");
  const provider = input.provider;
  const repo = input.repoFullName.trim();
  const ref = input.ref.trim() || "main";
  if (!repo) throw new Error("repoFullName is required");

  const { rows } = await query<KbSourceRow>(
    [
      "insert into kb_sources (client_id, provider, repo_full_name, ref, last_synced_sha, last_synced_at)",
      "values ($1, $2, $3, $4, $5, now())",
      "on conflict (client_id, provider, repo_full_name, ref) do update set",
      "  last_synced_sha = excluded.last_synced_sha,",
      "  last_synced_at = now(),",
      "  updated_at = now()",
      "returning id, client_id, provider, repo_full_name, ref, last_synced_sha, last_synced_at, created_at, updated_at",
    ].join("\n"),
    [input.clientId, provider, repo, ref, input.lastSyncedSha ?? null]
  );
  return one(rows, "Failed to upsert KB source");
}

export async function listKbSourcesByClientId(clientId: string): Promise<KbSourceRow[]> {
  assertUuid(clientId, "clientId");
  const { rows } = await query<KbSourceRow>(
    [
      "select id, client_id, provider, repo_full_name, ref, last_synced_sha, last_synced_at, created_at, updated_at",
      "from kb_sources",
      "where client_id = $1",
      "order by updated_at desc",
    ].join("\n"),
    [clientId]
  );
  return rows;
}

export async function deleteKbChunksForFile(input: {
  clientId: string;
  sourceId: string;
  path: string;
}): Promise<number> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.sourceId, "sourceId");
  const p = input.path.trim();
  if (!p) throw new Error("path is required");
  const { rows } = await query<{ id: string }>(
    [
      "delete from kb_chunks",
      "where client_id = $1 and source_id = $2 and path = $3",
      "returning id",
    ].join("\n"),
    [input.clientId, input.sourceId, p]
  );
  return rows.length;
}

export async function listKbChunkDigestsForFile(input: {
  clientId: string;
  sourceId: string;
  path: string;
}): Promise<Array<{ startLine: number; endLine: number; contentHash: string; hasEmbedding: boolean }>> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.sourceId, "sourceId");
  const p = input.path.trim();
  if (!p) throw new Error("path is required");
  const { rows } = await query<{
    start_line: number;
    end_line: number;
    content_hash: string;
    has_embedding: boolean;
  }>(
    [
      "select start_line, end_line, content_hash, (embedding is not null) as has_embedding",
      "from kb_chunks",
      "where client_id = $1 and source_id = $2 and path = $3",
    ].join("\n"),
    [input.clientId, input.sourceId, p]
  );
  return rows.map((r) => ({
    startLine: Number(r.start_line),
    endLine: Number(r.end_line),
    contentHash: String(r.content_hash),
    hasEmbedding: Boolean((r as any).has_embedding),
  }));
}

export async function deleteKbChunksNotInRangesForFile(input: {
  clientId: string;
  sourceId: string;
  path: string;
  keep: Array<{ startLine: number; endLine: number }>;
}): Promise<number> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.sourceId, "sourceId");
  const p = input.path.trim();
  if (!p) throw new Error("path is required");
  const keep = input.keep ?? [];
  if (keep.length === 0) {
    return await deleteKbChunksForFile({ clientId: input.clientId, sourceId: input.sourceId, path: p });
  }

  const startLines = keep.map((k) => k.startLine);
  const endLines = keep.map((k) => k.endLine);

  const { rows } = await query<{ id: string }>(
    [
      "with keep as (",
      "  select unnest($4::int[]) as start_line, unnest($5::int[]) as end_line",
      ")",
      "delete from kb_chunks c",
      "where c.client_id = $1 and c.source_id = $2 and c.path = $3",
      "  and not exists (select 1 from keep k where k.start_line = c.start_line and k.end_line = c.end_line)",
      "returning c.id",
    ].join("\n"),
    [input.clientId, input.sourceId, p, startLines, endLines]
  );
  return rows.length;
}

export async function insertKbChunk(input: {
  clientId: string;
  sourceId: string;
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  contentHash: string;
  embedding?: string | null; // pgvector literal, e.g. "[0.1,0.2,...]"
  tokenCount?: number | null;
  symbol?: string | null;
  kind?: string | null;
  language?: string | null;
}): Promise<void> {
  assertUuid(input.clientId, "clientId");
  assertUuid(input.sourceId, "sourceId");
  const p = input.path.trim();
  if (!p) throw new Error("path is required");
  if (!input.content) throw new Error("content is required");
  if (!input.contentHash) throw new Error("contentHash is required");

  await query(
    [
      "insert into kb_chunks (client_id, source_id, path, start_line, end_line, content, content_hash, embedding, token_count, symbol, kind, language)",
      "values ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9, $10, $11, $12)",
      "on conflict (source_id, path, start_line, end_line) do update set",
      "  content = excluded.content,",
      "  content_hash = excluded.content_hash,",
      "  embedding = coalesce(excluded.embedding, kb_chunks.embedding),",
      "  token_count = coalesce(excluded.token_count, kb_chunks.token_count),",
      "  symbol = excluded.symbol,",
      "  kind = excluded.kind,",
      "  language = excluded.language,",
      "  updated_at = now()",
    ].join("\n"),
    [
      input.clientId,
      input.sourceId,
      p,
      input.startLine,
      input.endLine,
      input.content,
      input.contentHash,
      input.embedding ?? null,
      input.tokenCount ?? null,
      input.symbol ?? null,
      input.kind ?? null,
      input.language ?? null,
    ]
  );
}

export async function searchKbChunksByEmbedding(input: {
  clientId: string;
  embedding: string; // pgvector literal
  limit?: number;
  repoFullName?: string;
  pathPrefix?: string;
}): Promise<
  Array<{
    source: KbSourceRow;
    chunk: Pick<KbChunkRow, "id" | "path" | "start_line" | "end_line" | "content">;
    distance: number;
  }>
> {
  assertUuid(input.clientId, "clientId");
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);

  const repo = input.repoFullName?.trim() || null;
  const prefix = input.pathPrefix?.trim() || null;

  const where: string[] = ["s.client_id = $2"];
  const params: any[] = [input.embedding, input.clientId];
  let idx = 3;

  if (repo) {
    where.push(`s.repo_full_name = $${idx++}`);
    params.push(repo);
  }
  if (prefix) {
    where.push(`c.path like $${idx++}`);
    params.push(prefix.replace(/%/g, "\\%") + "%");
  }

  const sql = [
    "select",
    "  s.id as source_id, s.client_id as source_client_id, s.provider as source_provider, s.repo_full_name as source_repo_full_name, s.ref as source_ref,",
    "  s.last_synced_sha as source_last_synced_sha, s.last_synced_at as source_last_synced_at, s.created_at as source_created_at, s.updated_at as source_updated_at,",
    "  c.id as chunk_id, c.path as chunk_path, c.start_line as chunk_start_line, c.end_line as chunk_end_line, c.content as chunk_content,",
    "  (c.embedding <-> $1::vector) as distance",
    "from kb_chunks c",
    "join kb_sources s on s.id = c.source_id",
    "where " + where.join(" and "),
    "  and c.embedding is not null",
    "order by c.embedding <-> $1::vector asc",
    `limit ${limit}`,
  ].join("\n");

  const { rows } = await query<any>(sql, params);
  return rows.map((r) => ({
    source: {
      id: r.source_id,
      client_id: r.source_client_id,
      provider: r.source_provider,
      repo_full_name: r.source_repo_full_name,
      ref: r.source_ref,
      last_synced_sha: r.source_last_synced_sha,
      last_synced_at: r.source_last_synced_at,
      created_at: r.source_created_at,
      updated_at: r.source_updated_at,
    } as KbSourceRow,
    chunk: {
      id: r.chunk_id,
      path: r.chunk_path,
      start_line: Number(r.chunk_start_line),
      end_line: Number(r.chunk_end_line),
      content: r.chunk_content,
    },
    distance: Number(r.distance),
  }));
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
  personaKey?: string | null;
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
      "  persona_key = coalesce($3, persona_key),",
      "  name = coalesce($4, name),",
      "  role = coalesce($5, role),",
      "  system_prompt = coalesce($6, system_prompt)",
      "where client_id = $1 and id = $2",
      "returning id, client_id, persona_key, name, role, system_prompt, created_at",
    ].join("\n"),
    [
      input.clientId,
      input.agentId,
      input.personaKey ?? null,
      input.name ?? null,
      input.role ?? null,
      input.systemPrompt ?? null,
    ]
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

export async function insertTokenUsageEvent(input: {
  clientId: string;
  agentId?: string | null;
  taskId?: string | null;
  provider: string;
  model: string;
  operation?: string;
  promptTokens?: number;
  completionTokens?: number;
  cachedPromptTokens?: number;
  reasoningTokens?: number;
  providerRequestId?: string | null;
  metadata?: unknown;
  occurredAt?: Date;
}): Promise<TokenUsageEventRow> {
  assertUuid(input.clientId, "clientId");
  if (input.agentId) assertUuid(input.agentId, "agentId");
  if (input.taskId) assertUuid(input.taskId, "taskId");

  const provider = String(input.provider ?? "").trim();
  const model = String(input.model ?? "").trim();
  if (!provider) throw new Error("provider is required");
  if (!model) throw new Error("model is required");

  const promptTokens = Math.max(0, Number(input.promptTokens ?? 0) || 0);
  const completionTokens = Math.max(0, Number(input.completionTokens ?? 0) || 0);
  const cachedPromptTokens = Math.max(0, Number(input.cachedPromptTokens ?? 0) || 0);
  const reasoningTokens = Math.max(0, Number(input.reasoningTokens ?? 0) || 0);
  const metadataJson = JSON.stringify(input.metadata ?? {});

  const { rows } = await query<TokenUsageEventRow>(
    [
      "insert into token_usage_events (",
      "  client_id, agent_id, task_id, provider, model, operation,",
      "  prompt_tokens, completion_tokens, cached_prompt_tokens, reasoning_tokens,",
      "  provider_request_id, metadata, occurred_at",
      ") values (",
      "  $1, $2, $3, $4, $5, $6,",
      "  $7, $8, $9, $10,",
      "  $11, $12::jsonb, $13",
      ")",
      "on conflict (provider, provider_request_id)",
      "where provider_request_id is not null",
      "do nothing",
      "returning",
      "  id, client_id, agent_id, task_id, provider, model, operation,",
      "  prompt_tokens, completion_tokens, cached_prompt_tokens, reasoning_tokens,",
      "  total_tokens,",
      "  input_cost_usd_micros, cached_input_cost_usd_micros, output_cost_usd_micros, total_cost_usd_micros,",
      "  markup_multiplier_snapshot, billable_usd_micros, pricing_version,",
      "  provider_request_id, metadata, occurred_at, created_at",
    ].join("\n"),
    [
      input.clientId,
      input.agentId ?? null,
      input.taskId ?? null,
      provider,
      model,
      input.operation ?? "chat.completion",
      promptTokens,
      completionTokens,
      cachedPromptTokens,
      reasoningTokens,
      input.providerRequestId ?? null,
      metadataJson,
      input.occurredAt?.toISOString() ?? new Date().toISOString(),
    ]
  );
  if (rows[0]) return rows[0];
  if (!input.providerRequestId) throw new Error("Failed to insert token usage event");

  const { rows: existing } = await query<TokenUsageEventRow>(
    [
      "select",
      "  id, client_id, agent_id, task_id, provider, model, operation,",
      "  prompt_tokens, completion_tokens, cached_prompt_tokens, reasoning_tokens,",
      "  total_tokens,",
      "  input_cost_usd_micros, cached_input_cost_usd_micros, output_cost_usd_micros, total_cost_usd_micros,",
      "  markup_multiplier_snapshot, billable_usd_micros, pricing_version,",
      "  provider_request_id, metadata, occurred_at, created_at",
      "from token_usage_events",
      "where provider = $1 and provider_request_id = $2",
      "limit 1",
    ].join("\n"),
    [provider, input.providerRequestId]
  );
  return one(existing, "Failed to load token usage event after conflict");
}

export async function insertTokenLedgerEntry(input: {
  clientId: string;
  entryType: TokenLedgerEntryType;
  tokens: number;
  referenceType?: string | null;
  referenceId?: string | null;
  note?: string | null;
  metadata?: unknown;
  createdByUserId?: string | null;
}): Promise<TokenLedgerEntryRow> {
  assertUuid(input.clientId, "clientId");
  if (input.referenceId) assertUuid(input.referenceId, "referenceId");
  if (input.createdByUserId) assertUuid(input.createdByUserId, "createdByUserId");

  const tokens = Math.trunc(Number(input.tokens));
  if (!Number.isFinite(tokens) || tokens === 0) {
    throw new Error("tokens must be a non-zero integer");
  }
  const metadataJson = JSON.stringify(input.metadata ?? {});

  const { rows } = await query<TokenLedgerEntryRow>(
    [
      "insert into token_ledger_entries (",
      "  client_id, entry_type, tokens, reference_type, reference_id, note, metadata, created_by_user_id",
      ") values (",
      "  $1, $2, $3, $4, $5, $6, $7::jsonb, $8",
      ")",
      "on conflict (reference_type, reference_id)",
      "where reference_type is not null and reference_id is not null",
      "do nothing",
      "returning id, client_id, entry_type, tokens, reference_type, reference_id, note, metadata, created_by_user_id, created_at",
    ].join("\n"),
    [
      input.clientId,
      input.entryType,
      tokens,
      input.referenceType ?? null,
      input.referenceId ?? null,
      input.note ?? null,
      metadataJson,
      input.createdByUserId ?? null,
    ]
  );

  if (rows[0]) return rows[0];
  if (!input.referenceType || !input.referenceId) throw new Error("Failed to insert token ledger entry");

  const { rows: existing } = await query<TokenLedgerEntryRow>(
    [
      "select id, client_id, entry_type, tokens, reference_type, reference_id, note, metadata, created_by_user_id, created_at",
      "from token_ledger_entries",
      "where reference_type = $1 and reference_id = $2",
      "limit 1",
    ].join("\n"),
    [input.referenceType, input.referenceId]
  );
  return one(existing, "Failed to load token ledger entry after conflict");
}

export async function getClientBillingProfileOrDefault(clientId: string): Promise<{
  clientId: string;
  markupMultiplier: number;
  freeMonthlyUsdMicros: number;
  billingMode: "usd_credits";
}> {
  assertUuid(clientId, "clientId");
  const { rows } = await query<{
    client_id: string;
    markup_multiplier: string;
    free_monthly_usd_micros: string;
    billing_mode: "usd_credits";
  }>(
    [
      "select",
      "  c.id as client_id,",
      "  coalesce(cbp.markup_multiplier, 1.0)::text as markup_multiplier,",
      "  coalesce(cbp.free_monthly_usd_micros, 0)::text as free_monthly_usd_micros,",
      "  coalesce(cbp.billing_mode, 'usd_credits')::text as billing_mode",
      "from clients c",
      "left join client_billing_profiles cbp on cbp.client_id = c.id",
      "where c.id = $1",
      "limit 1",
    ].join("\n"),
    [clientId]
  );
  const row = one(rows, "Client not found");
  return {
    clientId: row.client_id,
    markupMultiplier: Number(row.markup_multiplier),
    freeMonthlyUsdMicros: Number(row.free_monthly_usd_micros),
    billingMode: row.billing_mode,
  };
}

export async function upsertClientBillingProfile(input: {
  clientId: string;
  markupMultiplier?: number;
  freeMonthlyUsdMicros?: number;
  billingMode?: "usd_credits";
}): Promise<ClientBillingProfileRow> {
  assertUuid(input.clientId, "clientId");
  const markupMultiplier =
    input.markupMultiplier == null ? null : Math.max(0.0001, Number(input.markupMultiplier) || 0.0001);
  const freeMonthlyUsdMicros =
    input.freeMonthlyUsdMicros == null ? null : Math.max(0, Math.trunc(Number(input.freeMonthlyUsdMicros) || 0));

  const { rows } = await query<ClientBillingProfileRow>(
    [
      "insert into client_billing_profiles (client_id, markup_multiplier, free_monthly_usd_micros, billing_mode)",
      "values ($1, coalesce($2, 1.0), coalesce($3, 0), coalesce($4, 'usd_credits'))",
      "on conflict (client_id) do update set",
      "  markup_multiplier = coalesce($2, client_billing_profiles.markup_multiplier),",
      "  free_monthly_usd_micros = coalesce($3, client_billing_profiles.free_monthly_usd_micros),",
      "  billing_mode = coalesce($4, client_billing_profiles.billing_mode),",
      "  updated_at = now()",
      "returning client_id, markup_multiplier::text, free_monthly_usd_micros::text, billing_mode, created_at, updated_at",
    ].join("\n"),
    [input.clientId, markupMultiplier, freeMonthlyUsdMicros, input.billingMode ?? null]
  );
  return one(rows, "Failed to upsert client billing profile");
}

export async function createLlmPricingRate(input: {
  provider: string;
  model: string;
  operation: string;
  tokenType: LlmPricingTokenType;
  usdPer1mTokensMicros: number;
  pricingVersion?: string;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  active?: boolean;
}): Promise<LlmPricingRateRow> {
  const provider = String(input.provider ?? "").trim();
  const model = String(input.model ?? "").trim();
  const operation = String(input.operation ?? "").trim();
  if (!provider) throw new Error("provider is required");
  if (!model) throw new Error("model is required");
  if (!operation) throw new Error("operation is required");
  const price = Math.max(0, Math.trunc(Number(input.usdPer1mTokensMicros) || 0));

  const { rows } = await query<LlmPricingRateRow>(
    [
      "insert into llm_pricing_rates (",
      "  provider, model, operation, token_type, usd_per_1m_tokens, pricing_version, effective_from, effective_to, active",
      ") values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      "returning",
      "  id, provider, model, operation, token_type, usd_per_1m_tokens::text, pricing_version,",
      "  effective_from, effective_to, active, created_at, updated_at",
    ].join("\n"),
    [
      provider,
      model,
      operation,
      input.tokenType,
      price,
      input.pricingVersion ?? "v1",
      input.effectiveFrom?.toISOString() ?? new Date().toISOString(),
      input.effectiveTo?.toISOString() ?? null,
      input.active ?? true,
    ]
  );
  return one(rows, "Failed to create pricing rate");
}

export async function listLlmPricingRates(input?: {
  provider?: string;
  model?: string;
  operation?: string;
  active?: boolean;
  limit?: number;
}): Promise<LlmPricingRateRow[]> {
  const where: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (input?.provider) {
    where.push(`provider = $${i++}`);
    params.push(String(input.provider).trim());
  }
  if (input?.model) {
    where.push(`model = $${i++}`);
    params.push(String(input.model).trim());
  }
  if (input?.operation) {
    where.push(`operation = $${i++}`);
    params.push(String(input.operation).trim());
  }
  if (typeof input?.active === "boolean") {
    where.push(`active = $${i++}`);
    params.push(Boolean(input.active));
  }
  const limit = Math.min(Math.max(input?.limit ?? 100, 1), 500);
  const { rows } = await query<LlmPricingRateRow>(
    [
      "select id, provider, model, operation, token_type, usd_per_1m_tokens::text, pricing_version, effective_from, effective_to, active, created_at, updated_at",
      "from llm_pricing_rates",
      where.length > 0 ? `where ${where.join(" and ")}` : "",
      "order by effective_from desc, created_at desc",
      `limit ${limit}`,
    ].join("\n"),
    params
  );
  return rows;
}

export async function resolveLlmPricingForUsage(input: {
  provider: string;
  model: string;
  operation: string;
  occurredAt?: Date;
}): Promise<{
  pricingVersion: string;
  inputUsdPer1mTokensMicros: number;
  cachedInputUsdPer1mTokensMicros: number;
  outputUsdPer1mTokensMicros: number;
} | null> {
  const provider = String(input.provider ?? "").trim();
  const model = String(input.model ?? "").trim();
  const operation = String(input.operation ?? "").trim();
  if (!provider || !model || !operation) return null;
  const ts = input.occurredAt?.toISOString() ?? new Date().toISOString();

  async function pickRate(tokenType: LlmPricingTokenType): Promise<LlmPricingRateRow | null> {
    const { rows } = await query<LlmPricingRateRow>(
      [
        "select id, provider, model, operation, token_type, usd_per_1m_tokens::text, pricing_version, effective_from, effective_to, active, created_at, updated_at",
        "from llm_pricing_rates",
        "where provider = $1",
        "  and (",
        "    operation = $2",
        "    or operation = '*'",
        "    or (operation like '%*%' and $2 like replace(operation, '*', '%'))",
        "  )",
        "  and token_type = $3",
        "  and active = true",
        "  and effective_from <= $4",
        "  and (effective_to is null or effective_to > $4)",
        "  and (",
        "    model = $5",
        "    or model = '*'",
        "    or (model like '%*%' and $5 like replace(model, '*', '%'))",
        "  )",
        "order by",
        "  (operation = $2) desc,",
        "  ((operation like '%*%') and ($2 like replace(operation, '*', '%'))) desc,",
        "  length(replace(operation, '*', '')) desc,",
        "  (model = $5) desc,",
        "  ((model like '%*%') and ($5 like replace(model, '*', '%'))) desc,",
        "  length(replace(model, '*', '')) desc,",
        "  effective_from desc,",
        "  created_at desc",
        "limit 1",
      ].join("\n"),
      [provider, operation, tokenType, ts, model]
    );
    return rows[0] ?? null;
  }

  const inputRate = await pickRate("input");
  const cachedInputRate = await pickRate("cached_input");
  const outputRate = await pickRate("output");
  if (!inputRate || !outputRate) return null;

  const pricingVersion =
    outputRate.pricing_version || inputRate.pricing_version || cachedInputRate?.pricing_version || "v1";
  return {
    pricingVersion,
    inputUsdPer1mTokensMicros: Number(inputRate.usd_per_1m_tokens),
    cachedInputUsdPer1mTokensMicros: Number(
      (cachedInputRate ?? inputRate).usd_per_1m_tokens
    ),
    outputUsdPer1mTokensMicros: Number(outputRate.usd_per_1m_tokens),
  };
}

export async function updateTokenUsageEventPricing(input: {
  eventId: string;
  clientId: string;
  inputCostUsdMicros: number;
  cachedInputCostUsdMicros: number;
  outputCostUsdMicros: number;
  totalCostUsdMicros: number;
  markupMultiplierSnapshot: number;
  billableUsdMicros: number;
  pricingVersion: string;
  pricingMissing?: boolean;
}): Promise<TokenUsageEventRow> {
  assertUuid(input.eventId, "eventId");
  assertUuid(input.clientId, "clientId");

  const { rows } = await query<TokenUsageEventRow>(
    [
      "update token_usage_events",
      "set",
      "  input_cost_usd_micros = $3,",
      "  cached_input_cost_usd_micros = $4,",
      "  output_cost_usd_micros = $5,",
      "  total_cost_usd_micros = $6,",
      "  markup_multiplier_snapshot = $7,",
      "  billable_usd_micros = $8,",
      "  pricing_version = $9,",
      "  metadata = jsonb_set(",
      "    coalesce(metadata, '{}'::jsonb),",
      "    '{pricing_missing}',",
      "    to_jsonb($10::boolean),",
      "    true",
      "  )",
      "where id = $1 and client_id = $2",
      "returning",
      "  id, client_id, agent_id, task_id, provider, model, operation,",
      "  prompt_tokens, completion_tokens, cached_prompt_tokens, reasoning_tokens,",
      "  total_tokens,",
      "  input_cost_usd_micros, cached_input_cost_usd_micros, output_cost_usd_micros, total_cost_usd_micros,",
      "  markup_multiplier_snapshot, billable_usd_micros, pricing_version,",
      "  provider_request_id, metadata, occurred_at, created_at",
    ].join("\n"),
    [
      input.eventId,
      input.clientId,
      Math.max(0, Math.trunc(input.inputCostUsdMicros)),
      Math.max(0, Math.trunc(input.cachedInputCostUsdMicros)),
      Math.max(0, Math.trunc(input.outputCostUsdMicros)),
      Math.max(0, Math.trunc(input.totalCostUsdMicros)),
      String(input.markupMultiplierSnapshot),
      Math.max(0, Math.trunc(input.billableUsdMicros)),
      input.pricingVersion || "v1",
      Boolean(input.pricingMissing),
    ]
  );
  return one(rows, "Failed to update token usage pricing");
}

export async function getBillingBalanceSummaryScoped(clientId: string): Promise<{
  balanceUsdMicros: number;
  monthSpendUsdMicros: number;
  monthCreditsUsdMicros: number;
}> {
  assertUuid(clientId, "clientId");
  const { rows } = await query<{ balance: string; month_spend: string; month_credits: string }>(
    [
      "select",
      "  coalesce(sum(tokens), 0)::text as balance,",
      "  coalesce(sum(case when tokens < 0 and created_at >= date_trunc('month', now()) then -tokens else 0 end), 0)::text as month_spend,",
      "  coalesce(sum(case when tokens > 0 and created_at >= date_trunc('month', now()) then tokens else 0 end), 0)::text as month_credits",
      "from token_ledger_entries",
      "where client_id = $1",
    ].join("\n"),
    [clientId]
  );
  return {
    balanceUsdMicros: Number(rows[0]?.balance ?? "0"),
    monthSpendUsdMicros: Number(rows[0]?.month_spend ?? "0"),
    monthCreditsUsdMicros: Number(rows[0]?.month_credits ?? "0"),
  };
}

export async function listTokenLedgerEntriesScoped(input: {
  clientId: string;
  limit?: number;
  beforeCreatedAt?: string;
}): Promise<TokenLedgerEntryRow[]> {
  assertUuid(input.clientId, "clientId");
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const before = input.beforeCreatedAt ? new Date(input.beforeCreatedAt).toISOString() : null;
  const { rows } = await query<TokenLedgerEntryRow>(
    [
      "select id, client_id, entry_type, tokens, reference_type, reference_id, note, metadata, created_by_user_id, created_at",
      "from token_ledger_entries",
      "where client_id = $1",
      before ? "  and created_at < $2" : "",
      "order by created_at desc",
      `limit ${limit}`,
    ].join("\n"),
    before ? [input.clientId, before] : [input.clientId]
  );
  return rows;
}

export async function listTokenUsageEventsScoped(input: {
  clientId: string;
  from?: string;
  to?: string;
  agentId?: string;
  model?: string;
  provider?: string;
  operation?: string;
  limit?: number;
  offset?: number;
}): Promise<TokenUsageEventRow[]> {
  assertUuid(input.clientId, "clientId");
  if (input.agentId) assertUuid(input.agentId, "agentId");
  const where: string[] = ["client_id = $1"];
  const params: any[] = [input.clientId];
  let i = 2;
  if (input.from) {
    where.push(`occurred_at >= $${i++}`);
    params.push(new Date(input.from).toISOString());
  }
  if (input.to) {
    where.push(`occurred_at <= $${i++}`);
    params.push(new Date(input.to).toISOString());
  }
  if (input.agentId) {
    where.push(`agent_id = $${i++}`);
    params.push(input.agentId);
  }
  if (input.model) {
    where.push(`model = $${i++}`);
    params.push(input.model);
  }
  if (input.provider) {
    where.push(`provider = $${i++}`);
    params.push(input.provider);
  }
  if (input.operation) {
    where.push(`operation = $${i++}`);
    params.push(input.operation);
  }
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const offset = Math.max(input.offset ?? 0, 0);
  const { rows } = await query<TokenUsageEventRow>(
    [
      "select",
      "  id, client_id, agent_id, task_id, provider, model, operation,",
      "  prompt_tokens, completion_tokens, cached_prompt_tokens, reasoning_tokens,",
      "  total_tokens,",
      "  input_cost_usd_micros, cached_input_cost_usd_micros, output_cost_usd_micros, total_cost_usd_micros,",
      "  markup_multiplier_snapshot, billable_usd_micros, pricing_version,",
      "  provider_request_id, metadata, occurred_at, created_at",
      "from token_usage_events",
      `where ${where.join(" and ")}`,
      "order by occurred_at desc, created_at desc",
      `limit ${limit}`,
      `offset ${offset}`,
    ].join("\n"),
    params
  );
  return rows;
}

export async function getTokenUsageSummaryScoped(input: {
  clientId: string;
  from?: string;
  to?: string;
  agentId?: string;
  model?: string;
  provider?: string;
  operation?: string;
  groupBy?: "day" | "model" | "agent" | "operation";
}): Promise<{
  totals: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    billableUsdMicros: number;
  };
  groups: Array<{
    key: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    billableUsdMicros: number;
  }>;
}> {
  assertUuid(input.clientId, "clientId");
  if (input.agentId) assertUuid(input.agentId, "agentId");
  const where: string[] = ["client_id = $1"];
  const params: any[] = [input.clientId];
  let i = 2;
  if (input.from) {
    where.push(`occurred_at >= $${i++}`);
    params.push(new Date(input.from).toISOString());
  }
  if (input.to) {
    where.push(`occurred_at <= $${i++}`);
    params.push(new Date(input.to).toISOString());
  }
  if (input.agentId) {
    where.push(`agent_id = $${i++}`);
    params.push(input.agentId);
  }
  if (input.model) {
    where.push(`model = $${i++}`);
    params.push(input.model);
  }
  if (input.provider) {
    where.push(`provider = $${i++}`);
    params.push(input.provider);
  }
  if (input.operation) {
    where.push(`operation = $${i++}`);
    params.push(input.operation);
  }

  const groupExpr =
    input.groupBy === "day"
      ? "to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD')"
      : input.groupBy === "agent"
        ? "coalesce(agent_id::text, 'none')"
        : input.groupBy === "operation"
          ? "operation"
          : "model";

  const { rows: totalsRows } = await query<{
    prompt_tokens: string;
    completion_tokens: string;
    total_tokens: string;
    billable_usd_micros: string;
  }>(
    [
      "select",
      "  coalesce(sum(prompt_tokens), 0)::text as prompt_tokens,",
      "  coalesce(sum(completion_tokens), 0)::text as completion_tokens,",
      "  coalesce(sum(total_tokens), 0)::text as total_tokens,",
      "  coalesce(sum(billable_usd_micros), 0)::text as billable_usd_micros",
      "from token_usage_events",
      `where ${where.join(" and ")}`,
    ].join("\n"),
    params
  );

  const { rows: groupRows } = await query<{
    group_key: string;
    prompt_tokens: string;
    completion_tokens: string;
    total_tokens: string;
    billable_usd_micros: string;
  }>(
    [
      `select ${groupExpr} as group_key,`,
      "  coalesce(sum(prompt_tokens), 0)::text as prompt_tokens,",
      "  coalesce(sum(completion_tokens), 0)::text as completion_tokens,",
      "  coalesce(sum(total_tokens), 0)::text as total_tokens,",
      "  coalesce(sum(billable_usd_micros), 0)::text as billable_usd_micros",
      "from token_usage_events",
      `where ${where.join(" and ")}`,
      "group by group_key",
      "order by group_key asc",
    ].join("\n"),
    params
  );

  const t = totalsRows[0];
  return {
    totals: {
      promptTokens: Number(t?.prompt_tokens ?? "0"),
      completionTokens: Number(t?.completion_tokens ?? "0"),
      totalTokens: Number(t?.total_tokens ?? "0"),
      billableUsdMicros: Number(t?.billable_usd_micros ?? "0"),
    },
    groups: groupRows.map((r) => ({
      key: r.group_key,
      promptTokens: Number(r.prompt_tokens),
      completionTokens: Number(r.completion_tokens),
      totalTokens: Number(r.total_tokens),
      billableUsdMicros: Number(r.billable_usd_micros),
    })),
  };
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

export async function getGitHubInstallationByInstallationId(
  installationId: number
): Promise<GitHubInstallationRow | null> {
  const id = Number(installationId);
  if (!Number.isFinite(id) || id <= 0) throw new Error("installationId must be a positive number");
  const { rows } = await query<GitHubInstallationRow>(
    [
      "select id, client_id, installation_id, owner_login, access_token, token_expires_at, created_at, updated_at",
      "from github_installations",
      "where installation_id = $1",
      "limit 1",
    ].join("\n"),
    [id]
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

