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
import * as github from "../integrations/github/githubTools";

// Core agent loop (plan → execute → summarize).
// Production intent:
// - Loads task context (task+agent+client) first, then scopes all downstream reads/writes by that client.
// - Execution is currently simulated; the “tool router” is the extension point for real GitHub/tool calls.
export type AgentExecutionResult = {
  taskId: string;
  plan: { steps: string[]; notes?: string };
  executed: Array<{ step: string; result: string }>;
  summary: string;
};

export async function runAgentTask(taskId: string): Promise<AgentExecutionResult> {
  const ctx = await getTaskContextById(taskId);

  try {
    await updateTaskStatus(taskId, "running");

    const memories = await loadAgentMemories({
      clientId: ctx.client.id,
      agentId: ctx.agent.id,
      limit: 50,
    });

    const plan = await createPlan({
      task: ctx.task,
      agent: ctx.agent,
      memories,
    });

    const executed: Array<{ step: string; result: string }> = [];
    for (const step of plan.steps) {
      const result = await simulateStep(step, { taskId });
      executed.push({ step, result });
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

async function simulateStep(
  step: string,
  ctx: { taskId: string }
): Promise<string> {
  const normalized = step.toLowerCase();
  const repo = process.env.GITHUB_REPO ?? "mock-org/mock-repo";
  const base = process.env.GITHUB_BASE_BRANCH ?? "main";
  const branch = `task-${ctx.taskId.slice(0, 8)}`;

  // Very small “tool router” scaffold. As you add tools, this becomes a real executor.
  if (normalized.includes("create_branch") || normalized.includes("create branch")) {
    const r = await github.create_branch({ repo, base, branch });
    return r.message;
  }

  if (normalized.includes("commit") || normalized.includes("commit_changes")) {
    const r = await github.commit_changes({
      repo,
      branch,
      message: `Work for task ${ctx.taskId}`,
    });
    return r.message;
  }

  if (
    normalized.includes("pull request") ||
    normalized.includes("open_pull_request") ||
    normalized.includes("open pr")
  ) {
    const r = await github.open_pull_request({
      repo,
      branch,
      base,
      title: `Task ${ctx.taskId}`,
      body: "Mocked PR body (GitHub integration scaffold).",
    });
    return r.message;
  }

  return `Simulated: ${step}`;
}

