import {
  buildEpisodicMemoryContent,
  loadAgentMemoriesForTask,
  type ConversationMemoryContext,
  type ToolArtifactRecord,
} from "./memoryService";
import { addAgentMemoryScoped, completeTask, failTask, getTaskContextById, updateTaskStatus } from "../db/schema";
import { createDefaultToolRegistry } from "./tools/defaultRegistry";
import { runReActLoop, type ToolExecutionRecord } from "./react_runner";
import { classifyCapabilities, finalizeAgentChatResponse } from "../services/llm/llmOrchestrationService";
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
  onAck?: () => Promise<void>;
  onPlanReady?: (plan: { steps: string[]; notes?: string }) => Promise<void>;
  onProgress?: (update: { type: "status"; text: string }) => Promise<void>;
  memoryContext?: ConversationMemoryContext;
};

export async function runAgentTaskReAct(taskId: string, options?: RunAgentTaskOptions): Promise<AgentExecutionResult> {
  const ctx = await getTaskContextById(taskId);
  const registry = createDefaultToolRegistry();

  try {
    await updateTaskStatus(taskId, "running");

    const memories = await loadAgentMemoriesForTask({
      clientId: ctx.client.id,
      agentId: ctx.agent.id,
      taskText: ctx.task.input,
      context: options?.memoryContext,
    });

    if (options?.onAck) {
      await options.onAck();
    }

    const toolAccess = await getToolAccessSummary({ clientId: ctx.client.id, agentId: ctx.agent.id });
    const taskInput = ctx.task.input;

    const heuristic = selectCapabilities(taskInput);
    const caps = listCapabilities().map((c) => ({ id: c.id, title: c.title, description: c.description }));
    const classified = await classifyCapabilities({
      taskText: taskInput,
      availableCapabilities: caps,
      toolAccessSummary: formatToolAccessSummary(toolAccess),
      usageContext: {
        clientId: ctx.client.id,
        agentId: ctx.agent.id,
        taskId,
      },
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
        const { final, executed, toolExecutions } = await runReActLoop({
          taskId,
          clientId: ctx.client.id,
          agentId: ctx.agent.id,
          agentSystemPrompt: ctx.agent.system_prompt,
          taskInput: constrainedTaskInput,
          memories,
          registry,
          toolAccess,
          capabilities,
          contextMode: options?.memoryContext?.contextMode,
          singleSourceType: options?.memoryContext?.singleSourceType,
          onProgress: options?.onProgress,
        });

        const finalized = await finalizeAgentChatResponse({
          agentName: ctx.agent.name,
          agentRole: ctx.agent.role,
          systemPrompt: ctx.agent.system_prompt,
          taskText: taskInput,
          executed,
          draft: final,
          profileMemories: memories.filter((m) => m.memory_type === "profile").slice(0, 1).map((m) => m.content),
          usageContext: {
            clientId: ctx.client.id,
            agentId: ctx.agent.id,
            taskId,
          },
        });

        await completeTask(taskId, finalized);

        await addAgentMemoryScoped({
          clientId: ctx.client.id,
          agentId: ctx.agent.id,
          memoryType: "episodic",
          content: buildEpisodicMemoryContent({
            version: "v1",
            taskId,
            summary: finalized,
            subjectHints: inferSubjectHints(taskInput),
            context: options?.memoryContext,
            artifacts: collectArtifactsFromExecutions(toolExecutions),
            executedCount: executed.length,
            createdAtIso: new Date().toISOString(),
          }),
        });

        return { taskId, executed, summary: finalized };
      }
    }

    const { final, executed, toolExecutions } = await runReActLoop({
      taskId,
      clientId: ctx.client.id,
      agentId: ctx.agent.id,
      agentSystemPrompt: ctx.agent.system_prompt,
      taskInput,
      memories,
      registry,
      toolAccess,
      capabilities,
      contextMode: options?.memoryContext?.contextMode,
      singleSourceType: options?.memoryContext?.singleSourceType,
      onProgress: options?.onProgress,
    });

    const finalized = await finalizeAgentChatResponse({
      agentName: ctx.agent.name,
      agentRole: ctx.agent.role,
      systemPrompt: ctx.agent.system_prompt,
      taskText: ctx.task.input,
      executed,
      draft: final,
      profileMemories: memories.filter((m) => m.memory_type === "profile").slice(0, 1).map((m) => m.content),
      usageContext: {
        clientId: ctx.client.id,
        agentId: ctx.agent.id,
        taskId,
      },
    });

    await completeTask(taskId, finalized);

    await addAgentMemoryScoped({
      clientId: ctx.client.id,
      agentId: ctx.agent.id,
      memoryType: "episodic",
      content: buildEpisodicMemoryContent({
        version: "v1",
        taskId,
        summary: finalized,
        subjectHints: inferSubjectHints(taskInput),
        context: options?.memoryContext,
        artifacts: collectArtifactsFromExecutions(toolExecutions),
        executedCount: executed.length,
        createdAtIso: new Date().toISOString(),
      }),
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

function collectArtifactsFromExecutions(executions: ToolExecutionRecord[]): ToolArtifactRecord[] {
  const out: ToolArtifactRecord[] = [];
  for (const e of executions) {
    if (Array.isArray(e.artifacts) && e.artifacts.length > 0) {
      for (const a of e.artifacts) out.push(a);
      continue;
    }
    // Fallback record for tools without explicit artifacts yet.
    out.push({
      tool: e.tool,
      kind: "tool_action",
      status: e.ok ? "ok" : "failed",
      metadata: { message: e.message.slice(0, 300) },
    });
  }
  return out.slice(0, 40);
}

function inferSubjectHints(taskText: string): string[] {
  const tokens = String(taskText ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_\-/\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  const stop = new Set(["the", "and", "for", "with", "this", "that", "from", "your", "about", "have", "agent"]);
  return Array.from(new Set(tokens.filter((t) => !stop.has(t)))).slice(0, 12);
}

