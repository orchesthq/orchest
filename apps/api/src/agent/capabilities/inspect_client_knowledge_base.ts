import type { CapabilityDefinition } from "./types";

export const inspectClientKnowledgeBaseCapability: CapabilityDefinition = {
  id: "inspect_client_knowledge_base",
  title: "Inspect client knowledge base (read-only)",
  description:
    "Answer company-specific questions by looking up facts in the knowledge base first, then (if needed) the linked codebase (read-only).",
  guide: [
    "Definition of done:",
    "- You used at least one lookup step (KB/code search/read) for company-specific questions.",
    "- You cite concrete evidence (file paths, key lines, behavior) instead of guessing.",
    "",
    "Workflow:",
    "- Default: call kb_search first. If it has hits, answer using those snippets (with citations).",
    "- If kb_search has no useful hits, fall back to GitHub code search + targeted reads.",
    "- Read the smallest relevant sections (avoid whole-file dumps). If a file is large, search within it first before reading chunks.",
    "- If you did NOT inspect the KB/repo, say so explicitly and ask for permission/context.",
  ].join("\n"),
  relevantTools: ["kb", "github"],
  check: ({ tools }) => {
    if (!tools.kb.available && !tools.github.available) {
      return {
        ok: false,
        reason:
          "Cannot inspect client knowledge base because no KB sources are synced and GitHub is not linked for this agent. Sync the KB or link GitHub.",
        missingTools: ["kb", "github"],
      };
    }
    return { ok: true };
  },
};

