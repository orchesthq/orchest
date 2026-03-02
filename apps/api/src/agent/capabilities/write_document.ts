import type { CapabilityDefinition } from "./types";

export const writeDocumentCapability: CapabilityDefinition = {
  id: "write_document",
  title: "Write a document",
  description: "Produce a standalone document (design/spec/options/plan) that makes sense out of chat context.",
  guide: [
    "Definition of done:",
    "- A clear title (H1) that is NOT the raw prompt.",
    "- A short Summary section that defines key terms/options referenced later.",
    "- Body sections with headings and bullets; actionable next steps when appropriate.",
    "",
    "Structure template:",
    "# <Title>",
    "## Summary",
    "- <1–3 bullets that make the doc understandable without chat context>",
    "## Context",
    "## Options / Proposal",
    "## Recommendation",
    "## Next steps",
    "",
    "Common failure mode to avoid: referencing “option (3)” without listing what (3) is in the doc.",
  ].join("\n"),
  relevantTools: ["slack"],
  // Writing a document can always be done in markdown in chat; publishing to a docs tool is optional.
  check: () => ({ ok: true }),
};

