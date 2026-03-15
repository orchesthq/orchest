import { createOpenAiClient } from "./openaiClient";
import type { LlmClient } from "./llmClient";

// Provider routing entry point.
// Today we only instantiate OpenAI-compatible client, but this is where
// Anthropic/Gemini/etc. clients can be selected in future.
export async function getLlmClient(): Promise<LlmClient | null> {
  return await createOpenAiClient();
}
