import type { AgentRow, AgentMemoryRow, TaskRow } from "../db/schema";
import { planTask, type PlanOutput } from "../services/openaiService";
import { memoriesForPrompt } from "./memoryService";

export type AgentPlan = PlanOutput;

export async function createPlan(input: {
  task: TaskRow;
  agent: AgentRow;
  memories: AgentMemoryRow[];
}): Promise<AgentPlan> {
  const memories = memoriesForPrompt(input.memories);
  return await planTask({
    taskInput: input.task.input,
    agentSystemPrompt: input.agent.system_prompt,
    memories,
  });
}

