import {
  addAgentMemoryScoped,
  failTask,
  getTaskContextById,
  updateTaskStatus,
  completeTask,
} from "../db/schema";
import { loadAgentMemories } from "./memoryService";
import { createPlan } from "./planningService";
import { summarizeResults } from "../services/openaiService";
import { createDefaultToolRegistry } from "./tools/defaultRegistry";
import { runAgentTaskReAct } from "./reactLoop";

// Core agent loop (plan → execute → summarize).
// Production intent:
// - Loads task context (task+agent+client) first, then scopes all downstream reads/writes by that client.
// - Execution is currently simulated; the “tool router” is the extension point for real GitHub/tool calls.
export type AgentExecutionResult = {
  taskId: string;
  plan?: { steps: string[]; actions: Array<{ tool: string; arguments: Record<string, unknown> }>; notes?: string };
  executed: Array<{ step: string; result: string }>;
  summary: string;
};

export type RunAgentTaskOptions = {
  onPlanReady?: (plan: { steps: string[]; notes?: string }) => Promise<void>;
  onProgress?: (update: { type: "status"; text: string }) => Promise<void>;
};

export async function runAgentTask(
  taskId: string,
  options?: RunAgentTaskOptions
): Promise<AgentExecutionResult> {
  const engine = (process.env.ORCHEST_AGENT_ENGINE ?? "legacy").toLowerCase();
  if (engine === "react") {
    return await runAgentTaskReAct(taskId, options);
  }
  return await runAgentTaskLegacy(taskId, options);
}

async function runAgentTaskLegacy(
  taskId: string,
  options?: RunAgentTaskOptions
): Promise<AgentExecutionResult> {
  const ctx = await getTaskContextById(taskId);

  try {
    await updateTaskStatus(taskId, "running");

    const memories = await loadAgentMemories({
      clientId: ctx.client.id,
      agentId: ctx.agent.id,
      limit: 50,
    });

    const registry = createDefaultToolRegistry();
    const plan = await createPlan({
      task: ctx.task,
      agent: ctx.agent,
      memories,
    });

    if (options?.onPlanReady) {
      await options.onPlanReady(plan);
    }

    const executed: Array<{ step: string; result: string }> = [];
    for (const action of plan.actions) {
      const r = await registry.execute({
        ctx: { taskId, clientId: ctx.client.id, agentId: ctx.agent.id },
        name: action.tool,
        args: action.arguments,
      });
      executed.push({
        step: `${action.tool}(${safeJson(action.arguments)})`,
        result: r.message,
      });
    }

    const summary = await summarizeResults({
      taskInput: ctx.task.input,
      agentSystemPrompt: ctx.agent.system_prompt,
      plan,
      executed,
    });

    await completeTask(taskId, summary);

    // Persistent episodic memory so the agent “remembers” what it did.
    await addAgentMemoryScoped({
      clientId: ctx.client.id,
      agentId: ctx.agent.id,
      memoryType: "episodic",
      content: `Completed task ${taskId}:\n${summary}`,
    });

    return { taskId, plan, executed, summary };
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await failTask(taskId, `Task failed: ${message}`);
    } catch (secondary) {
      console.error("[agentLoop] failed to mark task failed", secondary);
    }
    throw err;
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "[unserializable]";
  }
}

