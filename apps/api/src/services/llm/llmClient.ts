import type { LlmUsageContext } from "../llmUsageBillingService";

export type TokenUsageContext = LlmUsageContext;

export type LlmToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type LlmChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string | null; tool_calls?: LlmToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export abstract class LlmClient {
  abstract readonly provider: string;
  abstract readonly defaultModel: string;

  abstract chatCompletionRaw(body: any, usageContext?: TokenUsageContext): Promise<any>;
  abstract embeddingsRaw(body: any, usageContext?: TokenUsageContext): Promise<any>;
}
