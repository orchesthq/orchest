import type { ToolRegistry, ToolResult } from "./tools/registry";
import { agentChatWithTools } from "../services/llm/llmOrchestrationService";
import type { CapabilityId } from "./capabilities/types";
import type { ToolAccessSummary } from "./tools/toolInventory";
import { getCapability } from "./capabilities/capabilityRegistry";
import { getEnabledToolGuides } from "./tools/toolGuides";
import { formatToolAccessSummary } from "./tools/toolInventory";
import type { ContextMode, SingleSourceType, ToolArtifactRecord } from "./memoryService";

type ReActOptions = {
  taskId: string;
  clientId: string;
  agentId: string;
  model?: string;
  agentSystemPrompt: string;
  taskInput: string;
  memories: Array<{ memory_type: string; content: string }>;
  registry: ToolRegistry;
  toolAccess?: ToolAccessSummary;
  capabilities?: CapabilityId[];
  contextMode?: ContextMode;
  singleSourceType?: SingleSourceType;
  maxIterations?: number;
  maxToolCalls?: number;
  onProgress?: (update: { type: "status"; text: string }) => Promise<void>;
};

type ExecutedStep = { step: string; result: string };
export type ToolExecutionRecord = {
  tool: string;
  ok: boolean;
  args: Record<string, unknown>;
  message: string;
  artifacts: ToolArtifactRecord[];
};
const CODE_WRITE_TOOLS = new Set(["github_apply_patch", "create_file_and_commit"]);

function synthesizeStatusFromToolCalls(calls: Array<{ name: string; arguments: Record<string, unknown> }>): string {
  const c = calls[0];
  if (!c) return "";
  const name = c.name;
  const args = c.arguments ?? {};
  if (name === "kb_search") {
    const q = typeof args.query === "string" ? args.query : "";
    return q ? `Searching the knowledge base for “${q.slice(0, 60)}”…` : "Searching the knowledge base…";
  }
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

function isLikelyClarifyingQuestion(finalText: string): boolean {
  const t = String(finalText ?? "").trim();
  if (!t) return false;
  const lc = t.toLowerCase();
  const questionCount = (t.match(/\?/g) ?? []).length;
  const hasClarifyCue =
    /\b(one quick question|quick question|before i continue|before i proceed|can you confirm|please confirm|which of these|which one|what is the source of truth)\b/i.test(
      t
    ) || /\b(a\)|b\)|c\)|d\))/.test(lc);
  // Keep this conservative: only short, question-like outputs should short-circuit.
  const shortMessage = t.length <= 1200 && t.split(/\n+/).length <= 22;
  return shortMessage && (hasClarifyCue || questionCount >= 1);
}

export async function runReActLoop(input: ReActOptions): Promise<{
  final: string;
  executed: ExecutedStep[];
  toolExecutions: ToolExecutionRecord[];
}> {
  const maxIterations = input.maxIterations ?? readIntEnv("ORCHEST_AGENT_MAX_ITERATIONS", 20);
  const maxToolCalls = input.maxToolCalls ?? readIntEnv("ORCHEST_AGENT_MAX_TOOL_CALLS", 30);
  const tools = input.registry.toOpenAiTools();

  // Use only the latest profile; include all episodic/semantic
  const dedupedMemories = input.memories.reduce<typeof input.memories>((acc, m) => {
    if (m.memory_type === "profile" && acc.some((x) => x.memory_type === "profile")) return acc;
    return [...acc, m];
  }, []);

  const memoryBlock =
    dedupedMemories.length === 0
      ? "No prior memories."
      : dedupedMemories
          .slice(0, 25)
          .map((m) => `- [${m.memory_type}] ${m.content}`)
          .join("\n");

  const systemParts: string[] = [
    input.agentSystemPrompt,
    "",
    "You are an autonomous agent completing the user's task.",
    "Make reasonable assumptions for minor details; only ask clarifying questions when you're blocked or when a meaningful choice would change the outcome.",
    "If the request is ambiguous, missing key information, or requires an important choice, ask up to 5 concise clarifying questions and stop (no tool calls).",
    "If you have enough information, proceed. Use tools when you need to inspect, verify, or change external systems (code, docs, integrations).",
    "",
    "Cursor-quality gate (do this for ANY tools / integrations):",
    "- Integration-first: prefer modifying the existing codepath/entry point over adding standalone new modules.",
    "- No dead code: if you add a new file or helper, you MUST wire it into an existing entry point unless the task explicitly asks for a standalone utility.",
    "- Verification: before making changes, locate the current behavior in the code/tooling. Do not guess.",
    "- Minimal diffs: prefer patch-style edits that touch the smallest necessary surface area.",
    "- No surprise test frameworks: do NOT add *.test.* files or new test dependencies unless the repo already has tests set up or the user asked you to add tests.",
    "- Before proposing a PR/change set, sanity-check that the changes match the intended scope (entry points affected, user-visible behavior).",
    "",
    "When calling tools, include a short, user-safe status sentence in the assistant message (no hidden reasoning).",
    "If you have enough information, respond with a final user-facing answer.",
  ];

  if (input.toolAccess) {
    systemParts.push("", "Available tools for this agent:", formatToolAccessSummary(input.toolAccess));
  }

  if (input.contextMode === "single_source") {
    systemParts.push(
      "",
      "Single-source mode is active.",
      "- Use only the provided source context for factual content.",
      "- Do not call kb_search or other retrieval tools unless the user explicitly asks for broader lookup."
    );
  }

  const capabilityIds: CapabilityId[] = Array.isArray(input.capabilities) && input.capabilities.length > 0 ? input.capabilities : [];
  if (capabilityIds.length > 0) {
    systemParts.push("", "Selected capabilities (in priority order):", capabilityIds.map((c) => `- ${c}`).join("\n"));
    for (const capId of capabilityIds.slice(0, 3)) {
      const cap = getCapability(capId);
      systemParts.push("", `Capability guide: ${cap.title}`, cap.guide);
    }

    if (input.toolAccess) {
      const relevantTools = Array.from(new Set(capabilityIds.flatMap((id) => getCapability(id).relevantTools)));
      const toolGuides = getEnabledToolGuides(input.toolAccess, relevantTools);
      for (const g of toolGuides) {
        systemParts.push("", `Tool guide: ${g.title}`, g.guide);
      }
    }
  }

  const system = systemParts.join("\n");

  const messages: Array<any> = [
    {
      role: "user",
      content: ["## Task", input.taskInput, "", "## Relevant memories", memoryBlock].join("\n"),
    },
  ];

  const executed: ExecutedStep[] = [];
  const toolExecutions: ToolExecutionRecord[] = [];
  const usedTools = new Set<string>();
  let toolCalls = 0;
  let didCritique = false;
  let groundingAttempts = 0;
  let codeWriteRecoveryAttempts = 0;
  let codeScopeCheckAttempts = 0;
  let successfulCodeWrites = 0;
  let successfulPatchWrites = 0;
  let successfulCreateWrites = 0;
  const recentCodeWriteFailures: string[] = [];
  let lastDraftFinal: string | null = null;

  for (let i = 0; i < maxIterations; i++) {
    const iterStart = Date.now();
    const resp = await agentChatWithTools({
      system,
      messages,
      tools,
      usageContext: {
        clientId: input.clientId,
        agentId: input.agentId,
        taskId: input.taskId,
        model: input.model,
      },
    });

    if (resp.type === "final") {
      lastDraftFinal = resp.final;

      // If the model asks a clarifying question, stop and wait for the user
      // instead of running the internal self-critique pass.
      if (isLikelyClarifyingQuestion(resp.final)) {
        return { final: resp.final, executed, toolExecutions };
      }

      // Hard grounding gate: if KB is available and capability requires company grounding,
      // ensure we executed kb_search at least once before finalizing.
      const needsKbGrounding =
        input.contextMode !== "single_source" &&
        Boolean(input.toolAccess?.kb?.available) &&
        Array.isArray(input.capabilities) &&
        (input.capabilities.includes("inspect_client_knowledge_base" as any) ||
          input.capabilities.includes("answer_question" as any));
      const hasKbSearch = usedTools.has("kb_search");
      if (needsKbGrounding && !hasKbSearch) {
        groundingAttempts += 1;
        if (groundingAttempts > 3) {
          return {
            final:
              "Stopped: client knowledge base grounding was required, but kb_search was not executed after multiple attempts.",
            executed,
            toolExecutions,
          };
        }
        messages.push({
          role: "user",
          content: [
            "Before answering, ground this in the client knowledge base.",
            "Call kb_search now using a concise query derived from the task (5–12 keywords).",
            "Then answer using the returned snippets with file+line citations.",
            "If kb_search returns no results, fall back to github_search_code + targeted reads (if available).",
            "Do not finalize until after you’ve performed this lookup.",
          ].join("\n"),
        });
        continue;
      }

      const needsCodeWrite =
        Array.isArray(input.capabilities) &&
        (input.capabilities as any[]).includes("change_code");
      if (needsCodeWrite && successfulCodeWrites === 0) {
        codeWriteRecoveryAttempts += 1;
        if (codeWriteRecoveryAttempts > 3) {
          const lastFailure =
            recentCodeWriteFailures.length > 0 ? recentCodeWriteFailures[recentCodeWriteFailures.length - 1] : "";
          const why = lastFailure ? ` Last failure: ${lastFailure}` : "";
          return {
            final:
              "Stopped: no code changes were successfully written after multiple attempts." +
              why +
              " Please retry with narrower scope or verify GitHub write permissions.",
            executed,
            toolExecutions,
          };
        }
        const failureHints =
          recentCodeWriteFailures.length === 0
            ? "No write tool was successfully executed yet."
            : `Recent write failure(s):\n- ${recentCodeWriteFailures.slice(-2).join("\n- ")}`;
        messages.push({
          role: "user",
          content: [
            "You have not completed this coding task yet because no code write succeeded.",
            failureHints,
            "Recovery steps:",
            "1) Re-read the target file(s) before editing.",
            "2) Use github_apply_patch with smaller hunks and stable context lines.",
            "3) If patching fails with context mismatch, refresh file content and retry with a tighter patch.",
            "4) Only finalize after at least one successful write tool call.",
          ].join("\n"),
        });
        continue;
      }

      // Prevent dead-end outputs where only brand-new files are created but nothing is wired.
      if (needsCodeWrite && successfulCreateWrites > 0 && successfulPatchWrites === 0) {
        codeWriteRecoveryAttempts += 1;
        if (codeWriteRecoveryAttempts <= 3) {
          messages.push({
            role: "user",
            content: [
              "Quality gate failed: you created new file(s) but did not patch an existing entry point.",
              "Wire the new code into the current codepath by editing existing file(s) with github_apply_patch.",
              "Only finalize after integration is complete.",
            ].join("\n"),
          });
          continue;
        }
      }
      if (needsCodeWrite && successfulCodeWrites > 0 && !usedTools.has("github_list_changed_files")) {
        codeScopeCheckAttempts += 1;
        if (codeScopeCheckAttempts <= 2) {
          messages.push({
            role: "user",
            content: [
              "Before finalizing, run github_list_changed_files for base...head and verify scope matches the request.",
              "If scope is too broad, narrow the patch before finalizing.",
            ].join("\n"),
          });
          continue;
        }
      }

      if (!didCritique) {
        didCritique = true;
        messages.push({ role: "assistant", content: resp.final });
        messages.push({
          role: "user",
          content: [
            "Before you finalize, do a quick quality check against the Cursor-quality gate.",
            "Checklist:",
            "- Did you locate the real entry point / current behavior (not guess)?",
            "- If you added any new helper/module, is it actually wired into an existing codepath?",
            "- Did you avoid introducing a new test framework or *.test.* file unless explicitly requested?",
            "- Do the changes match the intended scope (no unrelated edits)?",
            "- If this was a Q&A request, is your answer concise (aim: 5–12 lines) and grounded if company-specific?",
            "",
            "If anything is missing/incorrect, call the appropriate tool(s) to fix it.",
            "Otherwise, reply with the final answer. Do not mention that you performed a check.",
          ].join("\n"),
        });
        continue;
      }
      console.log("[agent][react] done", { taskId: input.taskId, iterations: i + 1, toolCalls, ms: Date.now() - iterStart });
      return { final: resp.final, executed, toolExecutions };
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
        return { final: "Stopped: exceeded maximum tool calls while working on this task.", executed, toolExecutions };
      }

      const toolStart = Date.now();
      const toolResult: ToolResult = await input.registry.execute({ ctx, name: call.name, args: call.arguments });
      const toolMs = Date.now() - toolStart;

      console.log("[agent][react] tool", { taskId: input.taskId, iteration: i + 1, tool: call.name, ok: toolResult.ok, ms: toolMs });

      usedTools.add(call.name);
      executed.push({ step: `${call.name}(${JSON.stringify(redactArgs(call.arguments))})`, result: toolResult.message });
      toolExecutions.push({
        tool: call.name,
        ok: Boolean(toolResult.ok),
        args: (call.arguments ?? {}) as Record<string, unknown>,
        message: toolResult.message,
        artifacts: extractToolArtifactsFromResult(toolResult, call.name),
      });
      if (CODE_WRITE_TOOLS.has(call.name)) {
        if (toolResult.ok) {
          successfulCodeWrites += 1;
          if (call.name === "github_apply_patch") successfulPatchWrites += 1;
          if (call.name === "create_file_and_commit") successfulCreateWrites += 1;
        } else {
          const clipped = String(toolResult.message ?? "").trim();
          if (clipped) recentCodeWriteFailures.push(clipped.slice(0, 240));
          if (recentCodeWriteFailures.length > 6) recentCodeWriteFailures.splice(0, recentCodeWriteFailures.length - 6);
        }
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(compactToolResultForModel(toolResult)) });
    }
  }

  return {
    final: lastDraftFinal ?? "Stopped: exceeded maximum iterations while working on this task.",
    executed,
    toolExecutions,
  };
}

function extractToolArtifactsFromResult(result: ToolResult, toolName: string): ToolArtifactRecord[] {
  const md = result.metadata ?? {};
  const raw = (md as any).artifacts;
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 20)
    .map((a: any) => {
      if (!a || typeof a !== "object") return null;
      const tool = typeof a.tool === "string" && a.tool.trim() ? a.tool.trim() : toolName;
      const out: ToolArtifactRecord = { tool };
      if (typeof a.kind === "string") out.kind = a.kind;
      if (typeof a.id === "string") out.id = a.id;
      if (typeof a.url === "string") out.url = a.url;
      if (typeof a.title === "string") out.title = a.title;
      if (typeof a.ref === "string") out.ref = a.ref;
      if (typeof a.path === "string") out.path = a.path;
      if (typeof a.container === "string") out.container = a.container;
      if (typeof a.status === "string") out.status = a.status;
      if (a.metadata && typeof a.metadata === "object" && !Array.isArray(a.metadata)) {
        out.metadata = a.metadata as Record<string, unknown>;
      }
      return out;
    })
    .filter((x): x is ToolArtifactRecord => Boolean(x));
}

