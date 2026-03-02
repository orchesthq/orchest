import type { CapabilityId } from "./types";

export function selectCapabilities(taskText: string): CapabilityId[] {
  const t = String(taskText ?? "").toLowerCase();

  const codeLike =
    /\b(github|repo|repository|pull request|pr\b|commit|branch|diff|patch|bug|fix|refactor|typescript|javascript|api route|sql migration)\b/i.test(
      t
    );
  const docLike =
    /\b(doc|document|spec|proposal|write[- ]?up|canvas|roadmap|plan|design)\b/i.test(t) ||
    t.includes("## ") ||
    t.includes("# ");

  if (codeLike) return ["change_code", "respond_in_chat"];
  if (docLike) return ["write_document", "respond_in_chat"];
  return ["respond_in_chat"];
}

