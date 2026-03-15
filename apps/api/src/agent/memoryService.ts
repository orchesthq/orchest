import type { MemoryForPrompt } from "../services/llm/llmOrchestrationService";
import {
  addAgentMemoryScoped,
  listAgentMemoriesByTypeScoped,
  listAgentMemoriesScoped,
  type AgentMemoryRow,
  type MemoryType,
} from "../db/schema";

const MEMORY_RECORD_PREFIX = "[[memory_record_v1]]";
const CONTINUATION_LIKE = /\b(continue|pick up|as discussed|same branch|where we left off|remember|last (time|week|day)|we were working on)\b/i;

export type MemoryContextPolicy = "session_primary" | "kb_plus_memory" | "kb_primary_memory_assist";
export type ContextMode = "single_source" | "multi_source";
export type SingleSourceType = "thread" | "external";

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
  contextPolicy?: MemoryContextPolicy;
  contextMode?: ContextMode;
  singleSourceType?: SingleSourceType;
  hasActiveSession?: boolean;
  sessionScore?: number;
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
  if (input.context?.contextMode === "single_source") {
    return [];
  }

  const policy = input.context?.contextPolicy ?? "kb_primary_memory_assist";
  const hasActiveSession = Boolean(input.context?.hasActiveSession);
  const defaults = policyDefaults(policy, hasActiveSession);
  const profileLimit = input.profileLimit ?? 1;
  const semanticLimit = input.semanticLimit ?? defaults.semanticLimit;
  const episodicCandidateLimit = input.episodicCandidateLimit ?? 120;
  const episodicTopK = input.episodicTopK ?? defaults.episodicTopK;

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
    policy,
    hasActiveSession,
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
  policy: MemoryContextPolicy;
  hasActiveSession: boolean;
  episodics: AgentMemoryRow[];
}): Array<{ row: AgentMemoryRow; score: number }> {
  const queryTerms = extractTerms(input.taskText);
  const continuationLike = CONTINUATION_LIKE.test(input.taskText);
  const weights = policyWeights(input.policy, input.hasActiveSession);

  return input.episodics
    .map((row, idx) => {
      const parsed = parseEpisodicMemoryContent(row.content);
      const haystack = `${row.content}\n${parsed?.summary ?? ""}\n${(parsed?.subjectHints ?? []).join(" ")}`.toLowerCase();
      const termHits = queryTerms.reduce((n, t) => (haystack.includes(t) ? n + 1 : n), 0);
      const maxHits = Math.max(1, queryTerms.length);
      const termScore = Math.min(4, (termHits / maxHits) * 4) * weights.term;

      // Recency bias from list order (already DESC by created_at).
      const recencyScore = Math.max(0, 2 - idx / 30) * weights.recency;

      const ctx = parsed?.context;
      let contextScore = 0;
      if (input.hasActiveSession) {
        if (input.context?.threadId && ctx?.threadId && input.context.threadId === ctx.threadId) contextScore += 10;
        if (input.context?.sessionId && ctx?.sessionId && input.context.sessionId === ctx.sessionId) contextScore += 8;
        if (
          input.context?.conversationId &&
          ctx?.conversationId &&
          input.context.conversationId === ctx.conversationId &&
          input.context?.surface &&
          ctx?.surface === input.context.surface
        )
          contextScore += 5;
      }
      if (input.context?.senderId && ctx?.senderId && input.context.senderId === ctx.senderId) contextScore += 1;
      if (input.context?.accountId && ctx?.accountId && input.context.accountId === ctx.accountId) contextScore += 1;
      contextScore *= weights.context;

      const continuationBoost = continuationLike ? 2.5 * weights.continuation : 0;
      const score = termScore + recencyScore + contextScore + continuationBoost;
      return { row, score };
    })
    .sort((a, b) => b.score - a.score);
}

function policyDefaults(
  policy: MemoryContextPolicy,
  hasActiveSession: boolean
): { episodicTopK: number; semanticLimit: number } {
  if (!hasActiveSession) {
    return { episodicTopK: 4, semanticLimit: 10 };
  }
  if (policy === "session_primary") return { episodicTopK: 12, semanticLimit: 6 };
  if (policy === "kb_plus_memory") return { episodicTopK: 8, semanticLimit: 8 };
  return { episodicTopK: 5, semanticLimit: 10 };
}

function policyWeights(
  policy: MemoryContextPolicy,
  hasActiveSession: boolean
): { context: number; term: number; recency: number; continuation: number } {
  if (!hasActiveSession) {
    return { context: 0.2, term: 1.0, recency: 1.15, continuation: 0.5 };
  }
  if (policy === "session_primary") return { context: 1.35, term: 1.0, recency: 1.0, continuation: 1.3 };
  if (policy === "kb_plus_memory") return { context: 0.9, term: 1.1, recency: 1.0, continuation: 1.0 };
  return { context: 0.35, term: 1.0, recency: 1.15, continuation: 0.7 };
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

