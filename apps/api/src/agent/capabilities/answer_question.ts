import type { CapabilityDefinition } from "./types";

export const answerQuestionCapability: CapabilityDefinition = {
  id: "answer_question",
  title: "Answer a question (KB-grounded Q&A)",
  description:
    "Answer a user question quickly and correctly. For company-specific questions, ground the answer in the client knowledge base first.",
  guide: [
    "Default behavior:",
    "- Keep answers short (aim: 5–12 lines).",
    "- If the question is company-specific, call kb_search first and answer from snippets with file+line citations.",
    "- If kb_search returns no results, say so and either (a) fall back to repo search/reads if available, or (b) ask 1–2 clarifying questions.",
    "",
    "Do NOT turn Q&A into a long document unless the user asks for a doc/spec.",
  ].join("\n"),
  relevantTools: ["kb", "github", "slack"],
  check: ({ tools }) => {
    // Q&A can always be answered from general knowledge; KB is strongly preferred for company-specific questions.
    // We don't hard-block here because the runner will enforce kb_search only when KB is available.
    if (!tools.kb.available && !tools.github.available) return { ok: true };
    return { ok: true };
  },
};

