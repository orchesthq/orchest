import type { CapabilityId } from "./types";

export function selectCapabilities(taskText: string): CapabilityId[] {
  const t = String(taskText ?? "").toLowerCase();

  const inspectLike =
    /\b(where is|where are|how does|how do|what changed|what does|explain|walk me through)\b/i.test(t) ||
    /\b(repo|repository|codebase|in the code|in orchest|in this repo)\b/i.test(t);
  const codeLike =
    /\b(github|repo|repository|pull request|pr\b|commit|branch|diff|patch|bug|fix|refactor|typescript|javascript|api route|sql migration)\b/i.test(
      t
    );
  const docLike =
    /\b(doc|document|spec|proposal|write[- ]?up|canvas|roadmap|plan|design)\b/i.test(t) ||
    t.includes("## ") ||
    t.includes("# ");

  if (codeLike) return ["change_code", "respond_in_chat"];
  if (inspectLike) return ["inspect_codebase", "respond_in_chat"];
  if (docLike) return ["write_document", "respond_in_chat"];
  return ["respond_in_chat"];
}

