import type { CapabilityDefinition } from "./types";

export const changeCodeCapability: CapabilityDefinition = {
  id: "change_code",
  title: "Change code",
  description: "Safely modify the codebase using the configured code-hosting tools (GitHub today).",
  guide: [
    "Definition of done:",
    "- You found the real entry point / call site (not guesswork).",
    "- Changes are minimal and scoped to the task.",
    "- If proposing a PR, you reviewed the changed files list and confirmed scope matches intent.",
    "",
    "Workflow:",
    "- Search → read the relevant files → patch existing codepaths → sanity-check diff → (optional) PR.",
    "- Prefer patch-based edits over rewriting whole files.",
    "- If you add a helper/module, wire it into an existing entry point (no dead code).",
  ].join("\n"),
  relevantTools: ["github"],
  check: ({ tools }) => {
    if (!tools.github.available) {
      return {
        ok: false,
        reason: "Cannot change code because GitHub is not linked for this agent.",
        missingTools: ["github"],
      };
    }
    if (tools.github.maxAccessLevel === "read" || !tools.github.maxAccessLevel) {
      return {
        ok: false,
        reason:
          "Cannot change code because this agent has read-only GitHub access. Update access to PR-only or direct-push.",
        missingTools: ["github"],
      };
    }
    return { ok: true };
  },
};

