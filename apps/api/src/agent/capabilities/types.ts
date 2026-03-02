import type { ToolAccessSummary } from "../tools/toolInventory";

export type CapabilityId =
  | "respond_in_chat"
  | "answer_question"
  | "write_document"
  | "inspect_client_knowledge_base"
  | "change_code";

export type CapabilityCheckResult =
  | { ok: true }
  | { ok: false; reason: string; missingTools?: Array<"github" | "slack" | "kb"> };

export type CapabilityDefinition = {
  id: CapabilityId;
  title: string;
  description: string;
  // Short, high-signal “how to do this well” guide.
  guide: string;
  // Tools that are typically used for this capability (may be optional).
  relevantTools: Array<"github" | "slack" | "kb">;
  // Returns ok=false if this capability is blocked without certain tools/access.
  check: (ctx: { tools: ToolAccessSummary }) => CapabilityCheckResult;
};

