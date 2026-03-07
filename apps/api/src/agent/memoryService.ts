import type { MemoryForPrompt } from "../services/openaiService";
import {
  addAgentMemoryScoped,
  listAgentMemoriesByTypeScoped,
  listAgentMemoriesScoped,
  type AgentMemoryRow,
  type MemoryType,
} from "../db/schema";

const MEMORY_RECORD_PREFIX = "[[memory_record_v1]]";

export type ConversationMemoryContext = {
  surface?: string;
  accountId?: string;
  conversationId?: string;
  threadId?: string | null;
  senderId?: string;
  /**
   * Surface-agnostic session identifier computed by the chat adapter/orchestrator.
   * Example: `slack:T123:C456:thread:1712345678.000100` or `slack:T123:D999:session`.
   */
  sessionId?: string;
};

export type ToolArtifactRecord = {
  tool: string;
  kind?: string;
  id?: string;
  url?: string;
  title?: string;
  ref?: string;
  path?: string;
  container?: string;
  status?: string;
  metadata?: Record<string, unknown>;
};

export type EpisodicMemoryRecord = {
  version: "v1";
  taskId: string;
  summary: string;
  subjectHints?: string[];
  context?: ConversationMemoryContext;
  artifacts?: ToolArtifactRecord[];
  executedCount?: number;
  createdAtIso?: string;
};

export async function loadAgentMemories(input: {
  clientId: string;
  agentId: string;
  limit?: number;
}): Promise<AgentMemoryRow[]> {
  return await listAgentMemoriesScoped({
    clientId: input.clientId,
    agentId: input.agentId,
    limit: input.limit ?? 50,
  });
}

export async function loadAgentMemoriesForTask(input: {
  clientId: string;
  agentId: string;
  taskText: string;
  context?: ConversationMemoryContext;
  profileLimit?: number;
  semanticLimit?: number;
  episodicCandidateLimit?: number;
  episodicTopK?: number;
}): Promise<AgentMemoryRow[]> {
  const profileLimit = input.profileLimit ?? 1;
  const semanticLimit = input.semanticLimit ?? 8;
  const episodicCandidateLimit = input.episodicCandidateLimit ?? 120;
  const episodicTopK = input.episodicTopK ?? 10;

  const [profiles, semantics, episodics] = await Promise.all([
    listAgentMemoriesByTypeScoped({
      clientId: input.clientId,
      agentId: input.agentId,
      memoryType: "profile",
      limit: profileLimit,
    }).catch(() => [] as AgentMemoryRow[]),
    listAgentMemoriesByTypeScoped({
      clientId: input.clientId,
      agentId: input.agentId,
      memoryType: "semantic",
      limit: semanticLimit,
    }).catch(() => [] as AgentMemoryRow[]),
    listAgentMemoriesByTypeScoped({
      clientId: input.clientId,
      agentId: input.agentId,
      memoryType: "episodic",
      limit: episodicCandidateLimit,
    }).catch(() => [] as AgentMemoryRow[]),
  ]);

  const rankedEpisodics = rankEpisodicMemories({
    taskText: input.taskText,
    context: input.context,
    episodics,
  })
    .slice(0, episodicTopK)
    .map((x) => x.row);

  return [...profiles, ...rankedEpisodics, ...semantics];
}

export function memoriesForPrompt(memories: AgentMemoryRow[]): MemoryForPrompt[] {
  // Keep the prompt compact and deterministic.
  return memories.slice(0, 25).map((m) => ({
    memory_type: m.memory_type,
    content: m.content,
  }));
}

export async function addAgentMemory(input: {
  clientId: string;
  agentId: string;
  memoryType: MemoryType;
  content: string;
}): Promise<AgentMemoryRow> {
  return await addAgentMemoryScoped({
    clientId: input.clientId,
    agentId: input.agentId,
    memoryType: input.memoryType,
    content: input.content,
  });
}

export function buildEpisodicMemoryContent(record: EpisodicMemoryRecord): string {
  return `${MEMORY_RECORD_PREFIX}\n${JSON.stringify(record)}`;
}

export function parseEpisodicMemoryContent(content: string): EpisodicMemoryRecord | null {
  const text = String(content ?? "").trim();
  if (!text.startsWith(MEMORY_RECORD_PREFIX)) return null;
  const raw = text.slice(MEMORY_RECORD_PREFIX.length).trim();
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as EpisodicMemoryRecord;
    if (!obj || obj.version !== "v1" || typeof obj.summary !== "string") return null;
    return obj;
  } catch {
    return null;
  }
}

function rankEpisodicMemories(input: {
  taskText: string;
  context?: ConversationMemoryContext;
  episodics: AgentMemoryRow[];
}): Array<{ row: AgentMemoryRow; score: number }> {
  const queryTerms = extractTerms(input.taskText);
  const continuationLike = /\b(continue|pick up|as discussed|remember|last (time|week|day)|we were working on)\b/i.test(
    input.taskText
  );

  return input.episodics
    .map((row, idx) => {
      const parsed = parseEpisodicMemoryContent(row.content);
      const haystack = `${row.content}\n${parsed?.summary ?? ""}\n${(parsed?.subjectHints ?? []).join(" ")}`.toLowerCase();
      const termHits = queryTerms.reduce((n, t) => (haystack.includes(t) ? n + 1 : n), 0);
      const maxHits = Math.max(1, queryTerms.length);
      const termScore = Math.min(4, (termHits / maxHits) * 4);

      // Recency bias from list order (already DESC by created_at).
      const recencyScore = Math.max(0, 2 - idx / 30);

      const ctx = parsed?.context;
      let contextScore = 0;
      if (input.context?.sessionId && ctx?.sessionId && input.context.sessionId === ctx.sessionId) contextScore += 8;
      if (
        input.context?.conversationId &&
        ctx?.conversationId &&
        input.context.conversationId === ctx.conversationId &&
        input.context?.surface &&
        ctx?.surface === input.context.surface
      )
        contextScore += 5;
      if (input.context?.threadId && ctx?.threadId && input.context.threadId === ctx.threadId) contextScore += 6;
      if (input.context?.senderId && ctx?.senderId && input.context.senderId === ctx.senderId) contextScore += 1.5;
      if (input.context?.accountId && ctx?.accountId && input.context.accountId === ctx.accountId) contextScore += 1.5;

      const continuationBoost = continuationLike ? 2.5 : 0;
      const score = termScore + recencyScore + contextScore + continuationBoost;
      return { row, score };
    })
    .sort((a, b) => b.score - a.score);
}

function extractTerms(text: string): string[] {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "your",
    "about",
    "into",
    "have",
    "please",
    "could",
    "would",
    "should",
    "agent",
  ]);
  return Array.from(
    new Set(
      String(text ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9_\-/\s]/g, " ")
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !stop.has(t))
    )
  ).slice(0, 20);
}

