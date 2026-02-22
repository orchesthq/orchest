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
};

type ExecutedStep = { step: string; result: string };

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
  const maxIterations =
    input.maxIterations ??
    readIntEnv("ORCHEST_AGENT_MAX_ITERATIONS", 20);
  const maxToolCalls =
    input.maxToolCalls ??
    readIntEnv("ORCHEST_AGENT_MAX_TOOL_CALLS", 30);
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
    "You are an autonomous agent completing the user's task. Use tools when you need to inspect or change the linked GitHub repository.",
    "If you have enough information, respond with a final user-facing summary.",
    "Be concise but complete. Prefer safe, minimal changes.",
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

  for (let i = 0; i < maxIterations; i++) {
    const iterStart = Date.now();
    const resp = await agentChatWithTools({
      system,
      messages,
      tools,
    });

    if (resp.type === "final") {
      if (!didCritique) {
        didCritique = true;
        messages.push({ role: "assistant", content: resp.final });
        messages.push({
          role: "user",
          content: [
            "## Self-check",
            "Did the result fully meet the task goal?",
            "- If anything is missing or incorrect, call the appropriate tool(s) to fix it.",
            "- Otherwise, reply with the final answer (no tool calls).",
          ].join("\n"),
        });
        continue;
      }
      console.log("[agent][react] done", {
        taskId: input.taskId,
        iterations: i + 1,
        toolCalls,
        ms: Date.now() - iterStart,
      });
      return { final: resp.final, executed };
    }

    const call = resp.toolCall;
    toolCalls++;
    if (toolCalls > maxToolCalls) {
      return {
        final: "Stopped: exceeded maximum tool calls while working on this task.",
        executed,
      };
    }

    const ctx = { taskId: input.taskId, clientId: input.clientId, agentId: input.agentId };
    const toolStart = Date.now();
    const toolResult: ToolResult = await input.registry.execute({
      ctx,
      name: call.name,
      args: call.arguments,
    });
    const toolMs = Date.now() - toolStart;

    console.log("[agent][react] tool", {
      taskId: input.taskId,
      iteration: i + 1,
      tool: call.name,
      ok: toolResult.ok,
      ms: toolMs,
    });

    executed.push({
      step: `${call.name}(${JSON.stringify(redactArgs(call.arguments))})`,
      result: toolResult.message,
    });

    // Feed tool results back into the model.
    messages.push(resp.assistantMessage);
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(compactToolResultForModel(toolResult)),
    });
  }

  return {
    final: "Stopped: exceeded maximum iterations while working on this task.",
    executed,
  };
}

