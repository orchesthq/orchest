import { z } from "zod";
import { isDbConfigured } from "../db/client";
import { getPartnerSetting } from "../db/schema";

export type MemoryForPrompt = {
  memory_type: "profile" | "episodic" | "semantic";
  content: string;
};

export type PlanOutput = {
  steps: string[];
  actions: Array<{ tool: string; arguments: Record<string, unknown> }>;
  notes?: string;
};

/** For Slack: either a quick conversational reply or hand off to full task flow. */
export type ConversationalResult =
  | { type: "chat"; reply: string }
  | { type: "task" };

export type CapabilityClassification = {
  capabilities: string[];
  confidence: number;
  reason?: string;
};

const planSchema = z.object({
  steps: z.array(z.string().min(1)).min(1),
  actions: z
    .array(
      z.object({
        tool: z.string().min(1),
        arguments: z.record(z.unknown()),
      })
    )
    .min(1),
  notes: z.string().optional(),
});

const summarySchema = z.object({
  summary: z.string().min(1),
});

type OpenAiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

const openAiPartnerSettingsSchema = z
  .object({
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
  })
  .passthrough();

const OPENAI_SETTINGS_CACHE_TTL_MS = 30_000;
let openAiConfigCache:
  | {
      loadedAtMs: number;
      config: OpenAiConfig | null;
    }
  | undefined;

function normalizeBaseUrl(raw: string | undefined): string {
  return (raw ?? "https://api.openai.com/v1").replace(/\/+$/, "");
}

async function getOpenAiConfigFromDb(): Promise<OpenAiConfig | null> {
  const row = await getPartnerSetting({ partner: "openai", key: "default" });
  if (!row) return null;
  const parsed = openAiPartnerSettingsSchema.safeParse(row.settings ?? null);
  if (!parsed.success) return null;
  const apiKey = parsed.data.apiKey?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: normalizeBaseUrl(parsed.data.baseUrl),
    model: parsed.data.model ?? "gpt-4o-mini",
  };
}

async function getOpenAiConfig(): Promise<OpenAiConfig | null> {
  const now = Date.now();
  if (openAiConfigCache && now - openAiConfigCache.loadedAtMs < OPENAI_SETTINGS_CACHE_TTL_MS) {
    return openAiConfigCache.config;
  }

  let config: OpenAiConfig | null = null;
  if (isDbConfigured()) {
    try {
      config = await getOpenAiConfigFromDb();
    } catch (err) {
      console.error("[openai] failed to load settings from DB", err);
    }
  }

  openAiConfigCache = { loadedAtMs: now, config };
  return config;
}

type OpenAiChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

async function chatCompletionRaw(cfg: OpenAiConfig, body: any): Promise<any> {
  const url = `${cfg.baseUrl}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: cfg.model, temperature: 0.2, ...body }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI-compatible API error: ${res.status} ${res.statusText} ${body}`);
  }

  return (await res.json()) as any;
}

async function embeddingsRaw(cfg: OpenAiConfig, body: any): Promise<any> {
  const url = `${cfg.baseUrl}/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI-compatible embeddings error: ${res.status} ${res.statusText} ${text}`);
  }
  return (await res.json()) as any;
}

async function chatCompletion(cfg: OpenAiConfig, input: { system: string; user: string }): Promise<string> {
  const json = await chatCompletionRaw(cfg, {
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
  });
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") throw new Error("Invalid LLM response shape");
  return content;
}

function deterministicMockPlan(taskInput: string): PlanOutput {
  const trimmed = taskInput.trim();
  const focus = trimmed.length > 0 ? trimmed : "the requested task";

  return {
    steps: [
      `Clarify the objective and constraints for: ${focus}`,
      "Identify the smallest production-minded change that satisfies the request",
      "Implement the change with clean types and client-safe data access",
      "Add or update tests/sanity checks if applicable",
      "Summarize the outcome and any follow-ups",
    ],
    actions: [
      {
        tool: "noop",
        arguments: {
          reason:
            "LLM is not configured; configure partner_settings(openai/default) to enable real execution.",
        },
      },
    ],
    notes:
      "Mock plan generated because OpenAI settings are not configured. Set partner_settings(openai/default) to enable real planning.",
  };
}

function deterministicMockSummary(results: {
  taskInput: string;
  executed: Array<{ step: string; result: string }>;
}): string {
  const lines = [
    `Task: ${results.taskInput}`,
    "",
    "Executed steps:",
    ...results.executed.map((r, i) => `${i + 1}. ${r.step}\n   - ${r.result}`),
    "",
    "Summary: Completed simulated execution (LLM mocked). Configure OpenAI settings to enable real planning/summarization.",
  ];
  return lines.join("\n");
}

export async function planTask(input: {
  taskInput: string;
  agentSystemPrompt: string;
  memories: MemoryForPrompt[];
  availableTools: Array<{ name: string; description: string }>;
}): Promise<PlanOutput> {
  const cfg = await getOpenAiConfig();
  if (!cfg) return deterministicMockPlan(input.taskInput);

  const memoryBlock =
    input.memories.length === 0
      ? "No prior memories."
      : input.memories
          .slice(0, 25)
          .map((m) => `- [${m.memory_type}] ${m.content}`)
          .join("\n");

  const toolDescriptions = input.availableTools.map((t) => `- ${t.name}: ${t.description}`).join("\n");

  const system = [
    input.agentSystemPrompt,
    "",
    "Plan the next task. Use only the tools provided.",
    "Call orchest_plan exactly once with a short step list and a structured tool-action list.",
  ].join("\n");

  const user = [
    `Task: ${input.taskInput}`,
    "",
    "Relevant memories:",
    memoryBlock,
    "",
    "Available tools:",
    toolDescriptions || "(none)",
    "",
    "Each action.tool must be an available tool name.",
  ].join("\n");

  const tools = [
    {
      type: "function",
      function: {
        name: "orchest_plan",
        description: "Return a plan with steps and structured tool actions to execute.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            steps: { type: "array", items: { type: "string" } },
            actions: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  tool: { type: "string" },
                  arguments: { type: "object" },
                },
                required: ["tool", "arguments"],
              },
            },
            notes: { type: "string" },
          },
          required: ["steps", "actions"],
        },
      },
    },
  ];

  const json = await chatCompletionRaw(cfg, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    tools,
    tool_choice: { type: "function", function: { name: "orchest_plan" } },
  });

  const toolCall = (json?.choices?.[0]?.message?.tool_calls?.[0] ??
    null) as OpenAiToolCall | null;
  if (toolCall?.type === "function" && toolCall.function?.name === "orchest_plan") {
    const args = safeParseJson(toolCall.function.arguments);
    const parsed = planSchema.safeParse(args);
    if (parsed.success) return parsed.data;
  }

  // Fallback: if tool calling isn't supported, accept JSON in content.
  const content = json?.choices?.[0]?.message?.content;
  const parsed = planSchema.safeParse(safeParseJson(typeof content === "string" ? content : ""));
  if (!parsed.success) return deterministicMockPlan(input.taskInput);
  return parsed.data;
}

export async function summarizeResults(input: {
  taskInput: string;
  agentSystemPrompt: string;
  plan: PlanOutput;
  executed: Array<{ step: string; result: string }>;
}): Promise<string> {
  const cfg = await getOpenAiConfig();
  if (!cfg) return deterministicMockSummary(input);

  const system = [
    input.agentSystemPrompt,
    "",
    "Summarize task execution for the client. Return ONLY valid JSON.",
    'JSON schema: {"summary": string}',
  ].join("\n");

  const user = [
    "## Task",
    input.taskInput,
    "",
    "## Plan",
    input.plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    "",
    "## Execution results",
    input.executed.map((r, i) => `${i + 1}. ${r.step}\n- ${r.result}`).join("\n\n"),
    "",
    "Write a clear, client-facing summary. CRITICAL: If any result says 'Not executed', 'Simulated', 'Mocked', or describes a failure/error, you MUST state explicitly that the step was NOT performed and why. Never claim work was done when it was not.",
  ].join("\n");

  const content = await chatCompletion(cfg, { system, user });
  const maybeJson = safeParseJson(content);
  const parsed = summarySchema.safeParse(maybeJson);
  if (!parsed.success) return deterministicMockSummary(input);
  return parsed.data.summary;
}

/**
 * Classifies a Slack message: greeting/quick chat → natural reply; work request → hand off to task flow.
 * Responds like a colleague: brief, human. No "Got it — I'm on it" for simple exchanges.
 */
export async function tryConversationalReply(input: {
  agentName: string;
  agentRole: string;
  systemPrompt: string;
  userMessage: string;
}): Promise<ConversationalResult> {
  const cfg = await getOpenAiConfig();
  if (!cfg) return { type: "task" };

  const system = [
    input.systemPrompt,
    "",
    "You are " + input.agentName + " (" + input.agentRole + ") chatting in Slack. Be a helpful colleague: natural, brief, human.",
    "",
    "If the user's message is a greeting, quick question, small talk, or simple request for info, reply in 1–2 short sentences. No JSON, no code blocks.",
    'If it is a work request (code, docs, research, multi-step task), reply with exactly "__TASK__" and nothing else.',
    'Treat any request to create or draft a document as a work request. Examples: "canvas", "doc", "PRD", "spec", "one-pager", "write-up", "notes", "Confluence", "Notion", "Google Doc".',
    "Treat any question about the user's specific product/company/system setup (agents, dashboard, system prompt, memories, internal behavior) as a work request so you can ground it in the client knowledge base.",
    "If you're unsure, reply with __TASK__.",
    "Never claim you lack Slack UI/API access. If the user asks for something you might need tooling for, reply __TASK__.",
  ].join("\n");

  const user = input.userMessage;

  const content = await chatCompletion(cfg, { system, user });
  const trimmed = content.trim();
  if (trimmed === "__TASK__" || trimmed.toLowerCase().includes("__task__")) {
    return { type: "task" };
  }
  return { type: "chat", reply: trimmed };
}

export async function classifyCapabilities(input: {
  taskText: string;
  availableCapabilities: Array<{ id: string; title: string; description: string }>;
  toolAccessSummary?: string;
}): Promise<CapabilityClassification | null> {
  const cfg = await getOpenAiConfig();
  if (!cfg) return null;

  const ids = input.availableCapabilities.map((c) => c.id);
  const idList = ids.map((id) => `- ${id}`).join("\n");
  const capBlock = input.availableCapabilities
    .map((c) => `- ${c.id}: ${c.title} — ${c.description}`)
    .join("\n");

  const schema = z.object({
    capabilities: z.array(z.enum(ids as [string, ...string[]])).min(1).max(3),
    confidence: z.number().min(0).max(1),
    reason: z.string().optional(),
  });

  const system = [
    "You are a routing classifier for an autonomous workplace agent.",
    "Choose which capabilities the user needs for this task.",
    "Return ONLY valid JSON (no prose, no markdown fences).",
    "",
    "Rules:",
    "- Only select from the available capability ids.",
    "- Prefer including respond_in_chat unless the user explicitly wants no chat output.",
    "- If the task is primarily about changing code, include change_code.",
    "- If the task is primarily a question the user wants answered quickly, include answer_question.",
    "- If the task is primarily about producing a standalone doc/spec/options, include write_document.",
    "- If the task asks about how the user's specific product/company/system works (agents, dashboard, system prompt, memories, internal workflows), include inspect_client_knowledge_base (if available) so the agent grounds answers in company context.",
  ].join("\n");

  const user = [
    "## Task",
    input.taskText,
    "",
    "## Available capabilities",
    capBlock || idList,
    "",
    input.toolAccessSummary ? ["## Available tools", input.toolAccessSummary, ""].join("\n") : "",
    'Return JSON like: {"capabilities":["respond_in_chat"],"confidence":0.7,"reason":"..."}',
  ]
    .filter(Boolean)
    .join("\n");

  const content = await chatCompletion(cfg, { system, user });
  const parsed = schema.safeParse(safeParseJson(content));
  if (!parsed.success) return null;

  const caps = parsed.data.capabilities.includes("respond_in_chat")
    ? parsed.data.capabilities
    : ["respond_in_chat", ...parsed.data.capabilities].slice(0, 3);

  return { ...parsed.data, capabilities: caps };
}

export async function embedText(input: {
  text: string;
  model?: string;
}): Promise<{ embedding: number[]; model: string } | null> {
  const cfg = await getOpenAiConfig();
  if (!cfg) return null;

  const model = input.model ?? "text-embedding-3-small";
  const text = String(input.text ?? "").trim();
  if (!text) return null;

  const json = await embeddingsRaw(cfg, {
    model,
    input: text.length > 20_000 ? text.slice(0, 20_000) : text,
  });

  const emb = json?.data?.[0]?.embedding;
  if (!Array.isArray(emb) || emb.length === 0) return null;
  return { embedding: emb.map((n: any) => Number(n)), model };
}

export async function generatePlanAck(input: {
  agentName: string;
  agentRole: string;
  systemPrompt: string;
  taskText: string;
  plan: { steps: string[]; notes?: string };
  profileMemories: string[];
}): Promise<string> {
  const cfg = await getOpenAiConfig();
  if (!cfg) {
    return "On it - I'll look this up and come back with one answer.";
  }

  const profileBlock =
    input.profileMemories.length === 0
      ? "No profile memories."
      : input.profileMemories.slice(0, 10).map((m) => `- ${m}`).join("\n");

  const system = [
    input.systemPrompt,
    "",
    `You are ${input.agentName} (${input.agentRole}) replying in chat.`,
    "Write a natural, human acknowledgement that you’re starting the task.",
    "Use the agent’s profile memories to shape voice and phrasing. Do not be robotic.",
    "Do not mention internal tooling. Speak like a colleague (e.g. 'I’ll take a look at the repo' not 'I will use tools').",
    "Keep it to exactly one short sentence.",
    "Do NOT answer the task itself and do NOT include plans, bullets, or numbered steps.",
    "No JSON, no code fences.",
  ].join("\n");

  const steps =
    input.plan.steps.length === 0 ? "(no steps)" : input.plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");

  const user = [
    "Task:",
    input.taskText,
    "",
    "Profile memories:",
    profileBlock,
    "",
    "Plan steps:",
    steps,
  ].join("\n");

  const json = await chatCompletionRaw(cfg, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.5,
  });

  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return clampAckToSingleSentence(content);
  return "On it - I'll look this up and come back with one answer.";
}

// Backwards-compatible alias (prefer generatePlanAck).
export async function generateSlackPlanAck(input: Parameters<typeof generatePlanAck>[0]): Promise<string> {
  return await generatePlanAck(input);
}

function clampAckToSingleSentence(raw: string): string {
  const fallback = "On it - I'll look this up and come back with one answer.";
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;

  // Keep only the first sentence to prevent accidental "first full answer" behavior.
  const first = text.match(/^[^.!?]{1,180}[.!?]/)?.[0] ?? text.slice(0, 180).trim();
  const clean = first.replace(/^[-*]\s+/, "").trim();
  if (!clean) return fallback;

  const wordCount = clean.split(/\s+/).filter(Boolean).length;
  if (wordCount > 30) return fallback;
  return clean;
}

export async function finalizeAgentChatResponse(input: {
  agentName: string;
  agentRole: string;
  systemPrompt: string;
  taskText: string;
  executed: Array<{ step: string; result: string }>;
  draft: string;
  profileMemories: string[];
}): Promise<string> {
  const cfg = await getOpenAiConfig();
  if (!cfg) return input.draft;

  const profileBlock =
    input.profileMemories.length === 0
      ? "No profile memories."
      : input.profileMemories.slice(0, 10).map((m) => `- ${m}`).join("\n");

  const executedBlock =
    input.executed.length === 0
      ? "No tools were executed."
      : input.executed.slice(0, 50).map((e, i) => `${i + 1}. ${e.step}\n   - ${e.result}`).join("\n");

  const system = [
    input.systemPrompt,
    "",
    `You are ${input.agentName} (${input.agentRole}) replying in chat.`,
    "Write the actual deliverable content the user asked for.",
    "Be honest: do NOT claim you reviewed code, accessed repos, or ran tools unless it appears in the executed tool log.",
    "If no tools were executed, say you did not inspect the repo and provide a best-effort design based on the request.",
    "If you used a document publishing tool (e.g. slack_canvas_publish) and it returned a link, keep the final chat message short and include only the link + a brief intro. Do NOT paste the full document again.",
    "No meta commentary like 'self-check' or 'the result meets the goal'. Just the deliverable.",
  ].join("\n");

  const user = [
    "Task:",
    input.taskText,
    "",
    "Profile memories:",
    profileBlock,
    "",
    "Executed tool log (ground truth):",
    executedBlock,
    "",
    "Draft answer (may be incomplete):",
    input.draft,
    "",
    "Now write the final chat response. Use headings and bullets if helpful.",
  ].join("\n");

  const json = await chatCompletionRaw(cfg, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.4,
  });

  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  return input.draft;
}

// Backwards-compatible alias (prefer finalizeAgentChatResponse).
export async function finalizeAgentSlackResponse(
  input: Parameters<typeof finalizeAgentChatResponse>[0]
): Promise<string> {
  return await finalizeAgentChatResponse(input);
}

function safeParseJson(text: string): unknown {
  // Handles models that wrap JSON in fences or extra prose.
  const stripped = text
    .trim()
    .replace(/^```json\\s*/i, "")
    .replace(/^```\\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

export type AgentToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export async function agentChatWithTools(input: {
  system: string;
  messages: Array<Omit<OpenAiChatMessage, "role"> & { role: "user" | "assistant" | "tool" }>;
  tools: Array<{ type: "function"; function: { name: string; description: string; parameters: any } }>;
}): Promise<
  | { type: "final"; final: string }
  | { type: "tool"; assistantMessage: OpenAiChatMessage; toolCalls: AgentToolCall[] }
> {
  const cfg = await getOpenAiConfig();
  if (!cfg) {
    return { type: "final", final: "LLM is not configured. Configure partner_settings(openai/default) to enable agent execution." };
  }

  const json = await chatCompletionRaw(cfg, {
    messages: [{ role: "system", content: input.system }, ...input.messages],
    tools: input.tools,
    tool_choice: "auto",
    parallel_tool_calls: false,
  });

  const msg = (json?.choices?.[0]?.message ?? null) as OpenAiChatMessage | null;
  const toolCalls = (msg as any)?.tool_calls as OpenAiToolCall[] | undefined;
  if (msg && Array.isArray(toolCalls) && toolCalls.length > 0) {
    const parsedToolCalls: AgentToolCall[] = toolCalls.map((tc) => {
      const parsedArgs = safeParseJson(tc.function?.arguments ?? "");
      const argsObj =
        parsedArgs && typeof parsedArgs === "object" && !Array.isArray(parsedArgs)
          ? (parsedArgs as Record<string, unknown>)
          : {};
      return { id: tc.id, name: tc.function.name, arguments: argsObj };
    });
    return {
      type: "tool",
      assistantMessage: { role: "assistant", content: msg.content ?? null, tool_calls: toolCalls },
      toolCalls: parsedToolCalls,
    };
  }

  const content = (msg as any)?.content;
  if (typeof content === "string" && content.trim().length > 0) {
    // Fallback: allow JSON tool call in content if tool calling isn't supported.
    const maybe = safeParseJson(content);
    if (maybe && typeof maybe === "object" && !Array.isArray(maybe)) {
      const tool = (maybe as any).tool;
      const args = (maybe as any).arguments;
      if (typeof tool === "string" && args && typeof args === "object" && !Array.isArray(args)) {
        return {
          type: "tool",
          assistantMessage: { role: "assistant", content },
          toolCalls: [{ id: "content_tool_call", name: tool, arguments: args as Record<string, unknown> }],
        };
      }
    }
    return { type: "final", final: content.trim() };
  }

  return { type: "final", final: "No response from model." };
}

