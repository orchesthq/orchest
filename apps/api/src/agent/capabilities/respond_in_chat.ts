import type { CapabilityDefinition } from "./types";

export const respondInChatCapability: CapabilityDefinition = {
  id: "respond_in_chat",
  title: "Respond in chat",
  description: "Respond conversationally to the user in the chat surface (Slack today).",
  guide: [
    "Goal: answer the user clearly and honestly in a chat context.",
    "- Be concise and high-signal. Ask questions only if blocked.",
    "- If the user asked for a document/spec, produce a structured markdown doc (title + summary + sections).",
    "- Avoid claiming to have performed actions you did not perform.",
  ].join("\n"),
  relevantTools: ["slack"],
  check: () => ({ ok: true }),
};

