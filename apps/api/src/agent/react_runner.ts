import type { ToolRegistry, ToolResult } from "./tools/registry";
import { agentChatWithTools } from "../services/openaiService";

type ReActOptions = {
  taskId: string;
  clientId: string;
  agentId: string;
  agentSystemPrompt: string;
  taskInput: string;
  memories: Array<{ memory_type: string; content: string }>;
  registry: ToolRegistry;
  maxIterations?: number;
  maxToolCalls?: number;
  onProgress?: (update: { type: "status"; text: string }) => Promise<void>;
};

type ExecutedStep = { step: string; result: string };

function synthesizeStatusFromToolCalls(calls: Array<{ name: string; arguments: Record<string, unknown> }>): string {
  const c = calls[0];
  if (!c) return "";
  const name = c.name;
  const args = c.arguments ?? {};
  if (name === "github_list_tree") return "Scanning the repo structure…";
  if (name === "github_search_code") {
    const q = typeof args.query === "string" ? args.query : "";
    return q ? `Searching the repo for “${q}”…` : "Searching the repo…";
  }
  if (name === "github_read_file") {
    const p = typeof args.path === "string" ? args.path : "";
    return p ? `Reading \`${p}\`…` : "Reading a file…";
  }
  if (name === "create_branch") return "Creating a branch…";
  if (name === "create_file_and_commit") {
    const p = typeof args.path === "string" ? args.path : "";
    return p ? `Writing \`${p}\` and committing…` : "Writing a file and committing…";
  }
  if (name === "open_pull_request") return "Opening a pull request…";
  if (name === "noop") return "Working on it…";
  return "Working on it…";
}

function synthesizeNonToolStatus(i: number): string {
  // Used when the model returns no tool calls and no usable status text.
  // Keep it short and human; avoid implying external actions.
  const options = [
    "Pulling this together…",
    "Drafting a clear response…",
    "Reviewing what we have so far…",
  ];
  return options[i % options.length]!;
}

function redactArgs(args: unknown): unknown {
  if (!args || typeof args !== "object") return args;
  const obj: any = Array.isArray(args) ? [] : {};
  for (const [k, v] of Object.entries(args as any)) {
    if (/key|secret|token|password|private/i.test(k)) {
      obj[k] = "[redacted]";
      continue;
    }
    if (typeof v === "string" && v.length > 500) {
      obj[k] = v.slice(0, 500) + "…[truncated]";
      continue;
    }
    obj[k] = v;
  }
  return obj;
}

function compactToolResultForModel(result: ToolResult): ToolResult {
  const maxString = 8_000;
  const maxItems = 50;
  const metadata = result.metadata ?? undefined;
  if (!metadata) return result;

  const compact: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (typeof v === "string") {
      compact[k] = v.length > maxString ? v.slice(0, maxString) + "\n\n[truncated]" : v;
      continue;
    }
    if (Array.isArray(v)) {
      compact[k] = v.slice(0, maxItems);
      continue;
    }
    compact[k] = v;
  }
  return { ...result, metadata: compact };
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function runReActLoop(input: ReActOptions): Promise<{ final: string; executed: ExecutedStep[] }> {
  const maxIterations = input.maxIterations ?? readIntEnv("ORCHEST_AGENT_MAX_ITERATIONS", 20);
  const maxToolCalls = input.maxToolCalls ?? readIntEnv("ORCHEST_AGENT_MAX_TOOL_CALLS", 30);
  const tools = input.registry.toOpenAiTools();

  const memoryBlock =
    input.memories.length === 0
      ? "No prior memories."
      : input.memories
          .slice(0, 25)
          .map((m) => `- [${m.memory_type}] ${m.content}`)
          .join("\n");

  const system = [
    input.agentSystemPrompt,
    "",
    "You are an autonomous agent completing the user's task.",
    "Make reasonable assumptions for minor details; only ask clarifying questions when you're blocked or when a meaningful choice would change the outcome.",
    "If the request is ambiguous, missing key information, or requires an important choice, ask up to 5 concise clarifying questions and stop (no tool calls).",
    "If you have enough information, proceed. Use tools when you need to inspect or change the linked GitHub repository.",
    "CRITICAL GitHub safety rules:",
    "- Prefer github_apply_patch over create_file_and_commit for existing files (avoid whole-file rewrites).",
    "- If github_read_file reports truncated=true (or content includes '[truncated]'), do NOT overwrite that file. Use github_read_file_chunk to fetch the needed parts first, then use github_apply_patch.",
    "- If you can't find something in a large file, use github_find_in_file to locate it (line windows + byte offsets) before reading or editing.",
    "- Before opening a PR, call github_list_changed_files and confirm the changed files match your intended scope. If not, fix before opening the PR.",
    "When calling tools, include a short, user-safe status sentence in the assistant message (no hidden reasoning).",
    "If you have enough information, respond with a final user-facing answer.",
  ].join("\n");

  const messages: Array<any> = [
    {
      role: "user",
      content: ["## Task", input.taskInput, "", "## Relevant memories", memoryBlock].join("\n"),
    },
  ];

  const executed: ExecutedStep[] = [];
  let toolCalls = 0;
  let didCritique = false;
  let lastDraftFinal: string | null = null;

  for (let i = 0; i < maxIterations; i++) {
    const iterStart = Date.now();
    const resp = await agentChatWithTools({ system, messages, tools });

    if (resp.type === "final") {
      lastDraftFinal = resp.final;
      if (!didCritique) {
        didCritique = true;
        messages.push({ role: "assistant", content: resp.final });
        messages.push({
          role: "user",
          content: [
            "Before you finalize, do a quick quality check.",
            "If anything is missing or incorrect, call the appropriate tool(s) to fix it.",
            "Otherwise, reply with the final answer. Do not mention that you performed a check.",
          ].join("\n"),
        });
        continue;
      }
      console.log("[agent][react] done", { taskId: input.taskId, iterations: i + 1, toolCalls, ms: Date.now() - iterStart });
      return { final: resp.final, executed };
    }

    messages.push(resp.assistantMessage);

    const statusText =
      typeof (resp.assistantMessage as any)?.content === "string" ? String((resp.assistantMessage as any).content).trim() : "";
    if (input.onProgress) {
      const base =
        statusText ||
        (resp.toolCalls.length > 0 ? synthesizeStatusFromToolCalls(resp.toolCalls) : synthesizeNonToolStatus(i));
      if (base) {
        const oneLine = base.replace(/\s+/g, " ").trim();
        const clipped = oneLine.length > 140 ? oneLine.slice(0, 140) + "…" : oneLine;
        await input.onProgress({ type: "status", text: clipped }).catch(() => {});
      }
    }

    const ctx = { taskId: input.taskId, clientId: input.clientId, agentId: input.agentId };
    for (const call of resp.toolCalls) {
      toolCalls++;
      if (toolCalls > maxToolCalls) {
        return { final: "Stopped: exceeded maximum tool calls while working on this task.", executed };
      }

      const toolStart = Date.now();
      const toolResult: ToolResult = await input.registry.execute({ ctx, name: call.name, args: call.arguments });
      const toolMs = Date.now() - toolStart;

      console.log("[agent][react] tool", { taskId: input.taskId, iteration: i + 1, tool: call.name, ok: toolResult.ok, ms: toolMs });

      executed.push({ step: `${call.name}(${JSON.stringify(redactArgs(call.arguments))})`, result: toolResult.message });

      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(compactToolResultForModel(toolResult)) });
    }
  }

  return { final: lastDraftFinal ?? "Stopped: exceeded maximum iterations while working on this task.", executed };
}

