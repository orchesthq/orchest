import type { MemoryForPrompt } from "../services/openaiService";
import {
  addAgentMemoryScoped,
  listAgentMemoriesScoped,
  type AgentMemoryRow,
  type MemoryType,
} from "../db/schema";

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

