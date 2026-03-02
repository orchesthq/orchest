import type { ToolAccessSummary, ToolId } from "./toolInventory";

export type ToolGuide = {
  tool: ToolId;
  title: string;
  guide: string;
  // If false, guide should not be shown (e.g., tool not available).
  enabled: (access: ToolAccessSummary) => boolean;
};

export const TOOL_GUIDES: ToolGuide[] = [
  {
    tool: "github",
    title: "GitHub (code changes)",
    enabled: (a) => a.github.available,
    guide: [
      "Safety rules:",
      "- Prefer patch-based edits over rewriting whole files.",
      "- If a file read is truncated, fetch needed chunks before editing.",
      "- For large files, search within the file before reading/editing.",
      "- Before opening a PR, review the changed files list and confirm scope matches intent.",
      "- For read-only investigations, use search + targeted reads and cite evidence; avoid guessing.",
      "",
      "Quality rules:",
      "- No dead code: new helpers must be wired into an entry point.",
      "- Avoid adding tests unless the repo already has a test runner or the user asked for tests.",
    ].join("\n"),
  },
  {
    tool: "slack",
    title: "Slack (chat + Canvas documents)",
    enabled: (a) => a.slack.available,
    guide: [
      "Chat behavior:",
      "- Keep chat replies concise; put long-form content into a structured document.",
      "",
      "Canvas docs:",
      "- Use a clean title (not the raw prompt).",
      "- Start the doc with a Summary section so it stands alone without chat context.",
      "- Use headings and bullets; define any numbered options you reference.",
    ].join("\n"),
  },
];

export function getEnabledToolGuides(access: ToolAccessSummary, tools: ToolId[]): ToolGuide[] {
  const want = new Set<ToolId>(tools);
  return TOOL_GUIDES.filter((g) => want.has(g.tool) && g.enabled(access));
}

