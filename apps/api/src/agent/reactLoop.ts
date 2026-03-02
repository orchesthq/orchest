import { loadAgentMemories } from "./memoryService";
import { addAgentMemoryScoped, completeTask, failTask, getTaskContextById, updateTaskStatus } from "../db/schema";
import { createDefaultToolRegistry } from "./tools/defaultRegistry";
import { runReActLoop } from "./react_runner";
import { classifyCapabilities, finalizeAgentSlackResponse } from "../services/openaiService";
import { getToolAccessSummary } from "./tools/toolInventory";
import { selectCapabilities } from "./capabilities/selector";
import { getCapability, listCapabilities } from "./capabilities/capabilityRegistry";
import { formatToolAccessSummary } from "./tools/toolInventory";

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

    // Let the Slack layer generate a natural in-character acknowledgement.
    // We intentionally avoid templated “review context / use tools / summarize” phrasing here.
    if (options?.onPlanReady) {
      await options.onPlanReady({ steps: [] });
    }

    const toolAccess = await getToolAccessSummary({ clientId: ctx.client.id, agentId: ctx.agent.id });
    const taskInput = ctx.task.input;

    const heuristic = selectCapabilities(taskInput);
    const caps = listCapabilities().map((c) => ({ id: c.id, title: c.title, description: c.description }));
    const classified = await classifyCapabilities({
      taskText: taskInput,
      availableCapabilities: caps,
      toolAccessSummary: formatToolAccessSummary(toolAccess),
    }).catch(() => null);

    const capabilities =
      classified && typeof classified.confidence === "number" && classified.confidence >= 0.55
        ? (classified.capabilities as any)
        : heuristic;

    // If the primary capability is blocked, instruct the model to ask for the missing tool/access.
    const primary = capabilities[0];
    if (primary) {
      const cap = getCapability(primary);
      const check = cap.check({ tools: toolAccess });
      if (!check.ok) {
        // Prepend a short, user-facing constraint reminder.
        // This keeps the runner/tooling generic while preventing “pretend” tool usage.
        const constrainedTaskInput =
          `${taskInput}\n\n` +
          `NOTE: This request maps to capability '${primary}', but it's currently blocked: ${check.reason}\n` +
          `Ask the user to connect/upgrade the required tool access and stop.`;
        // Pass constrainedTaskInput to the runner (do not mutate ctx).
        const { final, executed } = await runReActLoop({
          taskId,
          clientId: ctx.client.id,
          agentId: ctx.agent.id,
          agentSystemPrompt: ctx.agent.system_prompt,
          taskInput: constrainedTaskInput,
          memories,
          registry,
          toolAccess,
          capabilities,
          onProgress: options?.onProgress,
        });

        const finalized = await finalizeAgentSlackResponse({
          agentName: ctx.agent.name,
          agentRole: ctx.agent.role,
          systemPrompt: ctx.agent.system_prompt,
          taskText: taskInput,
          executed,
          draft: final,
          profileMemories: memories.filter((m) => m.memory_type === "profile").map((m) => m.content),
        });

        await completeTask(taskId, finalized);

        await addAgentMemoryScoped({
          clientId: ctx.client.id,
          agentId: ctx.agent.id,
          memoryType: "episodic",
          content: `Completed task ${taskId}:\n${finalized}`,
        });

        return { taskId, executed, summary: finalized };
      }
    }

    const { final, executed } = await runReActLoop({
      taskId,
      clientId: ctx.client.id,
      agentId: ctx.agent.id,
      agentSystemPrompt: ctx.agent.system_prompt,
      taskInput,
      memories,
      registry,
      toolAccess,
      capabilities,
      onProgress: options?.onProgress,
    });

    const finalized = await finalizeAgentSlackResponse({
      agentName: ctx.agent.name,
      agentRole: ctx.agent.role,
      systemPrompt: ctx.agent.system_prompt,
      taskText: ctx.task.input,
      executed,
      draft: final,
      profileMemories: memories.filter((m) => m.memory_type === "profile").map((m) => m.content),
    });

    await completeTask(taskId, finalized);

    await addAgentMemoryScoped({
      clientId: ctx.client.id,
      agentId: ctx.agent.id,
      memoryType: "episodic",
      content: `Completed task ${taskId}:\n${finalized}`,
    });

    return { taskId, executed, summary: finalized };
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

