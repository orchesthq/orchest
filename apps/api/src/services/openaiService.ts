import { z } from "zod";

export type MemoryForPrompt = {
  memory_type: "profile" | "episodic" | "semantic";
  content: string;
};

export type PlanOutput = {
  steps: string[];
  notes?: string;
};

/** For Slack: either a quick conversational reply or hand off to full task flow. */
export type ConversationalResult =
  | { type: "chat"; reply: string }
  | { type: "task" };

const planSchema = z.object({
  steps: z.array(z.string().min(1)).min(1),
  notes: z.string().optional(),
});

const summarySchema = z.object({
  summary: z.string().min(1),
});

function hasApiKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0);
}

function baseUrl(): string {
  return (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
}

function model(): string {
  return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
}

async function chatCompletion(input: { system: string; user: string }): Promise<string> {
  const url = `${baseUrl()}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model(),
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI-compatible API error: ${res.status} ${res.statusText} ${body}`);
  }

  const json = (await res.json()) as any;
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
    notes:
      "Mock plan generated because OPENAI_API_KEY is not configured. Set OPENAI_API_KEY to enable real planning.",
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
    "Summary: Completed simulated execution (LLM mocked). Configure OPENAI_API_KEY for real planning/summarization.",
  ];
  return lines.join("\n");
}

export async function planTask(input: {
  taskInput: string;
  agentSystemPrompt: string;
  memories: MemoryForPrompt[];
}): Promise<PlanOutput> {
  if (!hasApiKey()) return deterministicMockPlan(input.taskInput);

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
    "You are planning work for the next task. Return ONLY valid JSON.",
    'JSON schema: {"steps": string[], "notes"?: string}',
  ].join("\n");

  const user = [
    "## Task",
    input.taskInput,
    "",
    "## Relevant memories",
    memoryBlock,
    "",
    "Create a concise, executable step-by-step plan. Keep steps tool-friendly and unambiguous.",
  ].join("\n");

  const content = await chatCompletion({ system, user });
  const maybeJson = safeParseJson(content);
  const parsed = planSchema.safeParse(maybeJson);
  if (!parsed.success) return deterministicMockPlan(input.taskInput);
  return parsed.data;
}

export async function summarizeResults(input: {
  taskInput: string;
  agentSystemPrompt: string;
  plan: PlanOutput;
  executed: Array<{ step: string; result: string }>;
}): Promise<string> {
  if (!hasApiKey()) return deterministicMockSummary(input);

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

  const content = await chatCompletion({ system, user });
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
  if (!hasApiKey()) return { type: "task" };

  const system = [
    input.systemPrompt,
    "",
    "You are " + input.agentName + " (" + input.agentRole + ") chatting in Slack. Be a helpful colleague: natural, brief, human.",
    "",
    "If the user's message is a greeting, quick question, small talk, or simple request for info, reply in 1–2 short sentences. No JSON, no code blocks.",
    'If it is a work request (code, docs, research, multi-step task), reply with exactly "__TASK__" and nothing else.',
  ].join("\n");

  const user = input.userMessage;

  const content = await chatCompletion({ system, user });
  const trimmed = content.trim();
  if (trimmed === "__TASK__" || trimmed.toLowerCase().includes("__task__")) {
    return { type: "task" };
  }
  return { type: "chat", reply: trimmed };
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

