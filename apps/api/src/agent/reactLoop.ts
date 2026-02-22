import { loadAgentMemories } from "./memoryService";
import { addAgentMemoryScoped, completeTask, failTask, getTaskContextById, updateTaskStatus } from "../db/schema";
import { createDefaultToolRegistry } from "./tools/defaultRegistry";
import { runReActLoop } from "./reactRunner";

export type AgentExecutionResult = {
  taskId: string;
  plan?: { steps: string[]; actions: Array<{ tool: string; arguments: Record<string, unknown> }>; notes?: string };
  executed: Array<{ step: string; result: string }>;
  summary: string;
};

export type RunAgentTaskOptions = {
  onPlanReady?: (plan: { steps: string[]; notes?: string }) => Promise<void>;
};

export async function runAgentTaskReAct(taskId: string, options?: RunAgentTaskOptions): Promise<AgentExecutionResult> {
  const ctx = await getTaskContextById(taskId);
  const registry = createDefaultToolRegistry();

  try {
    await updateTaskStatus(taskId, "running");

    const memories = await loadAgentMemories({
      clientId: ctx.client.id,
      agentId: ctx.agent.id,
      limit: 50,
    });

    // ReAct loop will optionally emit its own intermediate updates (future).
    // For now, keep compatibility with Slack by emitting a minimal plan.
    if (options?.onPlanReady) {
      await options.onPlanReady({ steps: ["Review context", "Use tools to complete the task", "Summarize results"] });
    }

    const { final, executed } = await runReActLoop({
      taskId,
      clientId: ctx.client.id,
      agentId: ctx.agent.id,
      agentSystemPrompt: ctx.agent.system_prompt,
      taskInput: ctx.task.input,
      memories,
      registry,
    });

    await completeTask(taskId, final);

    await addAgentMemoryScoped({
      clientId: ctx.client.id,
      agentId: ctx.agent.id,
      memoryType: "episodic",
      content: `Completed task ${taskId}:\n${final}`,
    });

    return { taskId, executed, summary: final };
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await failTask(taskId, `Task failed: ${message}`);
    } catch (secondary) {
      console.error("[reactLoop] failed to mark task failed", secondary);
    }
    throw err;
  }
}

