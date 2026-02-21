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
import {
  create_branch,
  create_file_and_commit,
  open_pull_request,
} from "../integrations/github/githubTools";

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

export type RunAgentTaskOptions = {
  onPlanReady?: (plan: { steps: string[]; notes?: string }) => Promise<void>;
};

export async function runAgentTask(
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

    const plan = await createPlan({
      task: ctx.task,
      agent: ctx.agent,
      memories,
    });

    if (options?.onPlanReady) {
      await options.onPlanReady(plan);
    }

    const executed: Array<{ step: string; result: string }> = [];
    const githubCtx = { clientId: ctx.client.id, agentId: ctx.agent.id };
    for (const step of plan.steps) {
      const result = await executeStep(step, { taskId }, githubCtx);
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

async function executeStep(
  step: string,
  ctx: { taskId: string },
  githubCtx: { clientId: string; agentId: string }
): Promise<string> {
  const normalized = step.toLowerCase();
  const branch = `task-${ctx.taskId.slice(0, 8)}`;

  if (
    normalized.includes("create_branch") ||
    normalized.includes("create branch") ||
    normalized.includes("new branch")
  ) {
    const r = await create_branch(
      { repo: "", base: "main", branch },
      githubCtx
    );
    return r.ok ? r.message : r.message;
  }

  if (
    (normalized.includes("add") && (normalized.includes("file") || normalized.includes("content"))) ||
    normalized.includes("create file") ||
    normalized.includes("write file") ||
    normalized.includes("hello-world") ||
    normalized.includes("hello world")
  ) {
    const branchRes = await create_branch(
      { repo: "", base: "main", branch },
      githubCtx
    );
    if (!branchRes.ok) return branchRes.message;

    const r = await create_file_and_commit(
      {
        repo: "",
        branch,
        path: "hello-world.txt",
        content: "Hello, World!",
        message: "Add hello-world file",
      },
      githubCtx
    );
    return r.ok ? r.message : r.message;
  }

  if (
    normalized.includes("pull request") ||
    normalized.includes("open_pull_request") ||
    normalized.includes("open pr") ||
    (normalized.includes("pr") && (normalized.includes("open") || normalized.includes("create")))
  ) {
    const r = await open_pull_request(
      {
        repo: "",
        branch,
        base: "main",
        title: `Task ${ctx.taskId}`,
        body: "",
      },
      githubCtx
    );
    return r.ok ? r.message : r.message;
  }

  return `Not executed: no tool matched this step. The agent can create branches, add files (create_file_and_commit), and open PRs when linked to GitHub with a repository.`;
}

