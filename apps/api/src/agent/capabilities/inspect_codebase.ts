import type { CapabilityDefinition } from "./types";

export const inspectCodebaseCapability: CapabilityDefinition = {
  id: "inspect_codebase",
  title: "Inspect codebase (read-only)",
  description:
    "Answer questions by looking up facts in the linked codebase (read-only). Use this for “how does X work?”, “where is Y?”, “what changed?”, etc.",
  guide: [
    "Definition of done:",
    "- You used at least one lookup step (search/read) if the question is repo-specific.",
    "- You cite concrete evidence (file paths, key lines, behavior) instead of guessing.",
    "",
    "Workflow:",
    "- Use code search to find the right files/functions.",
    "- Read the smallest relevant sections (avoid whole-file dumps).",
    "- If a file is large, search within it first before reading chunks.",
    "- If you did NOT inspect the repo, say so explicitly and ask for permission/context.",
  ].join("\n"),
  relevantTools: ["github"],
  check: ({ tools }) => {
    if (!tools.github.available) {
      return {
        ok: false,
        reason: "Cannot inspect the codebase because GitHub is not linked for this agent.",
        missingTools: ["github"],
      };
    }
    // Read-only is fine for inspection.
    return { ok: true };
  },
};

