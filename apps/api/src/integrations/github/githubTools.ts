import {
  createBlob,
  createCommit,
  createPullRequest,
  createRef,
  createTree,
  compareCommits,
  getBlobContentBytes,
  getCommit,
  getFileContent,
  getFileContentBytes,
  getRef,
  getTree,
  searchCode,
  updateRef,
} from "./githubApi";
import { getValidInstallationToken, listAgentGitHubConnections } from "./githubService";
import { getGitHubInstallationById } from "../../db/schema";

export type GitHubToolResult = {
  ok: boolean;
  message: string;
  metadata?: Record<string, unknown>;
};

export type GitHubToolContext = {
  clientId: string;
  agentId: string;
};

function formatAllowedRepos(connections: Array<{ default_repo: string }>): string {
  const repos = connections.map((c) => c.default_repo);
  const uniq = Array.from(new Set(repos)).slice(0, 15);
  const more = repos.length > uniq.length ? ` (+${repos.length - uniq.length} more)` : "";
  return uniq.join(", ") + more;
}

async function resolveConnectionForRepo(
  ctx: GitHubToolContext | null,
  requestedRepo: string
): Promise<
  | {
      connection: {
        github_installation_id: string;
        commit_author_name: string;
        commit_author_email: string;
        access_level: string;
        default_branch: string;
      };
      repo: string;
    }
  | { error: string }
  | null
> {
  if (!ctx) return null;
  const connections = await listAgentGitHubConnections(ctx.clientId, ctx.agentId);
  if (connections.length === 0) return null;

  const repo = String(requestedRepo ?? "").trim();

  if (!repo) {
    const nonWildcard = connections.filter((c) => c.default_repo !== "*");
    if (nonWildcard.length === 1) {
      return { connection: nonWildcard[0], repo: nonWildcard[0].default_repo };
    }
    if (connections.length === 1 && connections[0]?.default_repo === "*") {
      return {
        error:
          "Repository is required. This agent is linked to *all repos*, so the tool call must include a repo like 'owner/name'.",
      };
    }
    return {
      error: `Repository is required. This agent is linked to multiple repos (${formatAllowedRepos(
        connections
      )}). Please specify which repo to act on.`,
    };
  }

  const exact = connections.find((c) => c.default_repo === repo);
  if (exact) return { connection: exact, repo };

  const wildcard = connections.find((c) => c.default_repo === "*");
  if (wildcard) return { connection: wildcard, repo };

  return {
    error: `Not executed: repo '${repo}' is not linked for this agent. Allowed repos: ${formatAllowedRepos(
      connections
    )}.`,
  };
}

async function getTokenAndRepo(
  ctx: GitHubToolContext | null,
  requestedRepo: string
): Promise<{
  token: string;
  repo: string;
  author: { name: string; email: string };
  defaultBranch: string;
  accessLevel: string;
} | { error: string } | null> {
  const resolved = await resolveConnectionForRepo(ctx, requestedRepo);
  if (!resolved) return null;
  if ("error" in resolved) return resolved;

  const installation = await getGitHubInstallationById(resolved.connection.github_installation_id);
  if (!installation) return null;

  const token = await getValidInstallationToken(installation.installation_id);
  return {
    token,
    repo: resolved.repo,
    author: {
      name: resolved.connection.commit_author_name,
      email: resolved.connection.commit_author_email,
    },
    defaultBranch: resolved.connection.default_branch,
    accessLevel: resolved.connection.access_level,
  };
}

function noAccessMessage(): string {
  return "Not executed: this agent is not linked to GitHub. Link the agent to GitHub in the Orchest dashboard and add at least one repository (or select 'all repos').";
}

function readOnlyMessage(): string {
  return "Not executed: this agent has read-only access. Configure write or PR access in the Orchest dashboard.";
}

export async function create_branch(
  input: { repo: string; base: string; branch: string },
  ctx?: GitHubToolContext | null
): Promise<GitHubToolResult> {
  const creds = await getTokenAndRepo(ctx ?? null, input.repo);
  if (!creds) {
    return { ok: false, message: noAccessMessage() };
  }
  if ("error" in creds) return { ok: false, message: creds.error };
  if (creds.accessLevel === "read") {
    return { ok: false, message: readOnlyMessage() };
  }

  const repo = creds.repo;

  try {
    const baseRef = await getRef(creds.token, repo, input.base);
    const baseSha = baseRef.object.sha;
    await createRef(creds.token, repo, input.branch, baseSha);
    return {
      ok: true,
      message: `Created branch '${input.branch}' from '${input.base}'.`,
      metadata: {
        artifacts: [
          {
            tool: "create_branch",
            kind: "branch",
            ref: input.branch,
            metadata: { base: input.base, repo },
          },
        ],
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/reference already exists|already exists/i.test(msg)) {
      return { ok: true, message: `Branch '${input.branch}' already exists, proceeding.` };
    }
    return { ok: false, message: `Failed to create branch: ${msg}` };
  }
}

export async function github_branch_exists(
  input: { repo: string; branch: string },
  ctx?: GitHubToolContext | null
): Promise<GitHubToolResult> {
  const creds = await getTokenAndRepo(ctx ?? null, input.repo);
  if (!creds) return { ok: false, message: noAccessMessage() };
  if ("error" in creds) return { ok: false, message: creds.error };

  const repo = creds.repo;
  const branch = String(input.branch ?? "").trim();
  if (!branch) return { ok: false, message: "Not executed: branch is required." };

  try {
    await getRef(creds.token, repo, branch);
    return {
      ok: true,
      message: `Branch '${branch}' exists.`,
      metadata: { repo, branch, exists: true },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/\b404\b/.test(msg) || /reference not found|not found/i.test(msg)) {
      return {
        ok: true,
        message: `Branch '${branch}' does not exist.`,
        metadata: { repo, branch, exists: false },
      };
    }
    return { ok: false, message: `Failed to check branch existence: ${msg}` };
  }
}

export async function create_file_and_commit(
  input: { repo: string; branch: string; path: string; content: string; message: string },
  ctx?: GitHubToolContext | null
): Promise<GitHubToolResult> {
  const creds = await getTokenAndRepo(ctx ?? null, input.repo);
  if (!creds) {
    return { ok: false, message: noAccessMessage() };
  }
  if ("error" in creds) return { ok: false, message: creds.error };
  if (creds.accessLevel === "read") {
    return { ok: false, message: readOnlyMessage() };
  }

  const repo = creds.repo;

  try {
    // Guardrail: this tool overwrites files. If the caller likely derived content from a truncated read,
    // we want the model to use chunked reads or patch-based editing instead.
    const hasTruncMarker = /\[truncated\]/i.test(String(input.content ?? "")) || /\[truncated\]/i.test(String(input.message ?? ""));
    if (hasTruncMarker) {
      return {
        ok: false,
        message:
          "Not executed: refusal to overwrite a file because the content appears to be based on truncated input. Use github_read_file_chunk to fetch the full file or use a patch-based tool.",
      };
    }

    // Safety: only allow NEW files with this tool.
    // If the file already exists, use github_apply_patch instead (prevents accidental whole-file rewrites).
    try {
      await getFileContent(creds.token, repo, input.path, input.branch);
      return {
        ok: false,
        message:
          `Not executed: ${input.path} already exists on branch '${input.branch}'. ` +
          "Use github_apply_patch to edit existing files (safer than overwriting).",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Continue only if it's a 404 (file not found). Any other error should abort.
      if (!/\b404\b/.test(msg) && !/Path is not a file/i.test(msg)) {
        return { ok: false, message: `Not executed: could not verify if file exists: ${msg}` };
      }
    }

    const branchRef = await getRef(creds.token, repo, input.branch);
    const commitSha = branchRef.object.sha;
    const commit = await getCommit(creds.token, repo, commitSha);
    const baseTreeSha = commit.tree.sha;

    const blob = await createBlob(creds.token, repo, input.content);
    const tree = await createTree(creds.token, repo, baseTreeSha, [
      { path: input.path, mode: "100644", type: "blob", sha: blob.sha },
    ]);
    const newCommit = await createCommit(
      creds.token,
      repo,
      input.message,
      tree.sha,
      commitSha,
      creds.author
    );
    await updateRef(creds.token, repo, input.branch, newCommit.sha);

    return {
      ok: true,
      message: `Created ${input.path} and committed: ${input.message}`,
      metadata: {
        files: [input.path],
        artifacts: [
          {
            tool: "create_file_and_commit",
            kind: "code_change",
            path: input.path,
            ref: input.branch,
            metadata: { repo, message: input.message },
          },
        ],
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to create file and commit: ${msg}` };
  }
}

export async function commit_changes(
  input: { repo: string; branch: string; message: string },
  ctx?: GitHubToolContext | null
): Promise<GitHubToolResult> {
  if (!ctx) return { ok: false, message: noAccessMessage() };
  return {
    ok: false,
    message:
      "Not executed: use create_file_and_commit to add or modify files. The generic 'commit_changes' tool is not implemented.",
  };
}

export async function open_pull_request(
  input: { repo: string; branch: string; base: string; title: string; body?: string },
  ctx?: GitHubToolContext | null
): Promise<GitHubToolResult> {
  const creds = await getTokenAndRepo(ctx ?? null, input.repo);
  if (!creds) {
    return { ok: false, message: noAccessMessage() };
  }
  if ("error" in creds) return { ok: false, message: creds.error };
  if (creds.accessLevel === "read") {
    return { ok: false, message: readOnlyMessage() };
  }

  const repo = creds.repo;

  try {
    // Safety gate: refuse to open PR if the diff is suspiciously large.
    // This catches common failure modes like truncated reads → accidental deletions.
    const cmp = await compareCommits(creds.token, repo, input.base, input.branch);
    const files = cmp.files ?? [];
    const totals = files.reduce(
      (acc, f) => {
        acc.additions += f.additions || 0;
        acc.deletions += f.deletions || 0;
        return acc;
      },
      { additions: 0, deletions: 0 }
    );
    const suspicious =
      files.length > 40 ||
      totals.deletions > 1500 ||
      (totals.deletions > 500 && totals.deletions > totals.additions * 4);

    if (suspicious) {
      return {
        ok: false,
        message:
          "Not executed: refusal to open PR because the diff looks unusually large. " +
          "Review the changes first with github_list_changed_files and fix scope before opening a PR.",
        metadata: { base: input.base, head: input.branch, totals, files: files.slice(0, 100) },
      };
    }

    const pr = await createPullRequest(
      creds.token,
      repo,
      input.title,
      input.branch,
      input.base,
      input.body
    );
    return {
      ok: true,
      message: `Opened PR #${pr.number}: ${input.title} – ${pr.html_url}`,
      metadata: {
        url: pr.html_url,
        number: pr.number,
        artifacts: [
          {
            tool: "open_pull_request",
            kind: "pull_request",
            id: String(pr.number),
            url: pr.html_url,
            ref: input.branch,
            title: input.title,
            metadata: { base: input.base, repo },
          },
        ],
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to open PR: ${msg}` };
  }
}

export async function github_read_file(
  input: { repo: string; path: string; ref?: string },
  ctx?: GitHubToolContext | null
): Promise<GitHubToolResult> {
  const creds = await getTokenAndRepo(ctx ?? null, input.repo);
  if (!creds) {
    return { ok: false, message: noAccessMessage() };
  }
  if ("error" in creds) return { ok: false, message: creds.error };
  const repo = creds.repo;

  try {
    const ref = input.ref?.trim() || creds.defaultBranch;
    const { bytes, size } = await getFileContentBytes(creds.token, repo, input.path, ref);
    const content = bytes.toString("utf8");
    const maxChars = 40_000;
    const isTruncated = content.length > maxChars;
    const truncated = isTruncated ? content.slice(0, maxChars) + "\n\n[truncated]" : content;
    return {
      ok: true,
      message: `Read ${input.path} at ${ref} (${content.length} chars).`,
      metadata: {
        path: input.path,
        ref,
        content: truncated,
        truncated: isTruncated,
        totalLength: content.length,
        totalBytes: size,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to read file: ${msg}` };
  }
}

export async function github_read_file_chunk(
  input: { repo: string; path: string; ref?: string; offset: number; length: number },
  ctx?: GitHubToolContext | null
): Promise<GitHubToolResult> {
  const creds = await getTokenAndRepo(ctx ?? null, input.repo);
  if (!creds) return { ok: false, message: noAccessMessage() };
  if ("error" in creds) return { ok: false, message: creds.error };
  const repo = creds.repo;

  const offset = Math.max(0, Math.floor(Number(input.offset ?? 0)));
  const length = Math.max(1, Math.min(200_000, Math.floor(Number(input.length ?? 1))));

  try {
    const ref = input.ref?.trim() || creds.defaultBranch;
    const { bytes, size } = await getFileContentBytes(creds.token, repo, input.path, ref);
    const end = Math.min(bytes.length, offset + length);
    const slice = bytes.subarray(offset, end);
    const content = slice.toString("utf8");
    return {
      ok: true,
      message: `Read ${input.path} bytes [${offset}, ${end}) at ${ref} (${content.length} chars).`,
      metadata: {
        path: input.path,
        ref,
        offset,
        length: end - offset,
        totalBytes: size,
        content,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to read file chunk: ${msg}` };
  }
}

export async function github_find_in_file(
  input: {
    repo: string;
    path: string;
    ref?: string;
    needle: string;
    caseInsensitive?: boolean;
    contextLines?: number;
    maxMatches?: number;
  },
  ctx?: GitHubToolContext | null
): Promise<GitHubToolResult> {
  const creds = await getTokenAndRepo(ctx ?? null, input.repo);
  if (!creds) return { ok: false, message: noAccessMessage() };
  if ("error" in creds) return { ok: false, message: creds.error };
  const repo = creds.repo;

  const needleRaw = String(input.needle ?? "").trim();
  if (!needleRaw) return { ok: false, message: "Not executed: needle is required." };

  const contextLines = Math.max(0, Math.min(50, Math.floor(Number(input.contextLines ?? 6))));
  const maxMatches = Math.max(1, Math.min(50, Math.floor(Number(input.maxMatches ?? 20))));
  const caseInsensitive = Boolean(input.caseInsensitive ?? false);

  try {
    const ref = input.ref?.trim() || creds.defaultBranch;
    const { bytes, size } = await getFileContentBytes(creds.token, repo, input.path, ref);
    if (bytes.length > 2_000_000) {
      return {
        ok: false,
        message:
          "File is too large for in-memory search (>2MB). Use github_read_file_chunk and search locally in chunks, or narrow the file/path.",
        metadata: { path: input.path, ref, totalBytes: size },
      };
    }

    const text = bytes.toString("utf8");
    const haystack = caseInsensitive ? text.toLowerCase() : text;
    const needle = caseInsensitive ? needleRaw.toLowerCase() : needleRaw;

    // Precompute line starts for mapping indices → line numbers.
    const lineStarts: number[] = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") lineStarts.push(i + 1);
    }
    const lineAt = (charIndex: number): number => {
      // Binary search lineStarts for last start <= charIndex
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const v = lineStarts[mid]!;
        if (v <= charIndex) lo = mid + 1;
        else hi = mid - 1;
      }
      return Math.max(1, hi + 1);
    };

    const matches: Array<{
      line: number;
      startChar: number;
      endChar: number;
      startByte: number;
      endByte: number;
      windowStartLine: number;
      windowEndLine: number;
      windowText: string;
    }> = [];

    let from = 0;
    while (matches.length < maxMatches) {
      const idx = haystack.indexOf(needle, from);
      if (idx === -1) break;
      const end = idx + needle.length;

      const line = lineAt(idx);
      const windowStartLine = Math.max(1, line - contextLines);
      const windowEndLine = Math.min(lineStarts.length, line + contextLines);

      const charStart = lineStarts[windowStartLine - 1] ?? 0;
      const charEnd =
        windowEndLine < lineStarts.length ? (lineStarts[windowEndLine] ?? text.length) : text.length;

      const windowText = text.slice(charStart, charEnd).trimEnd();

      // Approximate byte offsets (utf8) from char offsets.
      const startByte = Buffer.byteLength(text.slice(0, idx), "utf8");
      const endByte = Buffer.byteLength(text.slice(0, end), "utf8");

      matches.push({
        line,
        startChar: idx,
        endChar: end,
        startByte,
        endByte,
        windowStartLine,
        windowEndLine,
        windowText,
      });

      from = end;
    }

    if (matches.length === 0) {
      return {
        ok: true,
        message: `No matches for '${needleRaw}' in ${input.path} at ${ref}.`,
        metadata: { path: input.path, ref, totalBytes: size, matches: [] },
      };
    }

    return {
      ok: true,
      message: `Found ${matches.length} match(es) for '${needleRaw}' in ${input.path} at ${ref}.`,
      metadata: {
        path: input.path,
        ref,
        totalBytes: size,
        needle: needleRaw,
        caseInsensitive,
        matches: matches.map((m) => ({
          line: m.line,
          startByte: m.startByte,
          endByte: m.endByte,
          windowStartLine: m.windowStartLine,
          windowEndLine: m.windowEndLine,
          windowText: m.windowText,
        })),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to search in file: ${msg}` };
  }
}

export async function github_list_changed_files(
  input: { repo: string; base: string; head: string },
  ctx?: GitHubToolContext | null
): Promise<GitHubToolResult> {
  const creds = await getTokenAndRepo(ctx ?? null, input.repo);
  if (!creds) return { ok: false, message: noAccessMessage() };
  if ("error" in creds) return { ok: false, message: creds.error };
  const repo = creds.repo;

  try {
    const cmp = await compareCommits(creds.token, repo, input.base, input.head);
    const files = cmp.files.slice(0, 200);
    const totalAdd = files.reduce((n, f) => n + (f.additions || 0), 0);
    const totalDel = files.reduce((n, f) => n + (f.deletions || 0), 0);
    return {
      ok: true,
      message: `Compare ${input.base}...${input.head}: ${files.length} files changed (+${totalAdd}/-${totalDel}).`,
      metadata: { base: input.base, head: input.head, files, totals: { additions: totalAdd, deletions: totalDel } },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to list changed files: ${msg}` };
  }
}

function parseUnifiedDiff(patch: string): {
  files: Array<{ path: string; hunks: Array<{ header: string; lines: string[] }> }>;
  sawHunkHeader: boolean;
} {
  const text = String(patch ?? "");
  const lines = text.split(/\r?\n/);
  const files: Array<{ path: string; hunks: Array<{ header: string; lines: string[] }> }> = [];
  let current: { path: string; hunks: Array<{ header: string; lines: string[] }> } | null = null;
  let currentHunk: { header: string; lines: string[] } | null = null;
  let sawHunkHeader = false;
  let lastOldPath: string | null = null;

  const normalizePath = (raw: string): string => {
    const v = String(raw ?? "").trim().replace(/^"+|"+$/g, "");
    if (!v || v === "/dev/null") return "";
    if (v.startsWith("a/") || v.startsWith("b/")) return v.slice(2);
    return v;
  };

  const flushHunk = () => {
    if (current && currentHunk) {
      current.hunks.push(currentHunk);
      currentHunk = null;
    }
  };
  const flushFile = () => {
    flushHunk();
    if (current) {
      files.push(current);
      current = null;
    }
  };

  for (const line of lines) {
    if (line.startsWith("*** Begin Patch") || line.startsWith("*** End Patch") || line.startsWith("*** End of File")) {
      continue;
    }
    if (line.startsWith("*** Update File: ")) {
      flushFile();
      const path = normalizePath(line.slice("*** Update File: ".length));
      if (path) current = { path, hunks: [] };
      continue;
    }
    if (line.startsWith("diff --git ")) {
      flushFile();
      // Example: diff --git a/path b/path
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const path = m?.[2] ?? m?.[1];
      if (path) current = { path, hunks: [] };
      continue;
    }
    if (line.startsWith("--- ")) {
      lastOldPath = normalizePath(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ")) {
      flushFile();
      const newPath = normalizePath(line.slice(4));
      const path = newPath || lastOldPath || "";
      if (path) current = { path, hunks: [] };
      continue;
    }
    if (!current) continue;

    if (line.startsWith("@@")) {
      sawHunkHeader = true;
      flushHunk();
      currentHunk = { header: line, lines: [] };
      continue;
    }
    if (!currentHunk) continue;
    if (line.startsWith("\\ No newline at end of file")) continue;
    // Keep only diff body lines.
    if (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-")) {
      currentHunk.lines.push(line);
    }
  }
  flushFile();
  return { files: files.filter((f) => f.hunks.length > 0), sawHunkHeader };
}

function hunkOldAndNewLines(hunk: { lines: string[] }): { oldLines: string[]; newLines: string[] } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const raw of hunk.lines) {
    const tag = raw[0];
    const content = raw.slice(1);
    if (tag === " " || tag === "-") oldLines.push(content);
    if (tag === " " || tag === "+") newLines.push(content);
  }
  return { oldLines, newLines };
}

function parseHunkOldStart(header: string): number | null {
  const m = String(header ?? "").match(/^@@\s*-(\d+)(?:,\d+)?\s+\+\d+(?:,\d+)?\s*@@/);
  if (!m?.[1]) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function matchAt(lines: string[], at: number, needle: string[]): boolean {
  if (needle.length === 0) return true;
  if (at < 0 || at + needle.length > lines.length) return false;
  for (let i = 0; i < needle.length; i++) {
    if ((lines[at + i] ?? "") !== (needle[i] ?? "")) return false;
  }
  return true;
}

function findHunkMatch(lines: string[], oldLines: string[], preferredStart: number | null): number {
  if (oldLines.length === 0) {
    if (preferredStart == null) return Math.max(0, lines.length);
    return Math.max(0, Math.min(preferredStart, lines.length));
  }

  // 1) Try near the hunk's declared old-file line for standard unified diffs.
  if (preferredStart != null) {
    const maxDrift = 250;
    for (let drift = 0; drift <= maxDrift; drift++) {
      const down = preferredStart + drift;
      if (matchAt(lines, down, oldLines)) return down;
      if (drift === 0) continue;
      const up = preferredStart - drift;
      if (matchAt(lines, up, oldLines)) return up;
    }
  }

  // 2) Fallback to full scan (supports non-numeric @@ headers like '@@ function foo').
  for (let i = 0; i <= lines.length - oldLines.length; i++) {
    if (matchAt(lines, i, oldLines)) return i;
  }
  return -1;
}

function applyHunksToText(original: string, hunks: Array<{ header: string; lines: string[] }>): string {
  const lines = original.split(/\r?\n/);
  let lineDelta = 0;

  const fail = (msg: string) => {
    throw new Error(`Patch did not apply cleanly: ${msg}`);
  };

  for (let h = 0; h < hunks.length; h++) {
    const hunk = hunks[h]!;
    const { oldLines, newLines } = hunkOldAndNewLines(hunk);
    const oldStart = parseHunkOldStart(hunk.header);
    const preferred = oldStart == null ? null : Math.max(0, oldStart - 1 + lineDelta);
    const at = findHunkMatch(lines, oldLines, preferred);

    if (at < 0) {
      const targetLine = oldStart == null ? "unknown" : String(oldStart);
      fail(`context mismatch near hunk ${h + 1} (target old line ${targetLine})`);
    }

    lines.splice(at, oldLines.length, ...newLines);
    lineDelta += newLines.length - oldLines.length;
  }

  return lines.join("\n");
}

export async function github_apply_patch(
  input: { repo: string; branch: string; patch: string; message: string },
  ctx?: GitHubToolContext | null
): Promise<GitHubToolResult> {
  const creds = await getTokenAndRepo(ctx ?? null, input.repo);
  if (!creds) return { ok: false, message: noAccessMessage() };
  if ("error" in creds) return { ok: false, message: creds.error };
  if (creds.accessLevel === "read") return { ok: false, message: readOnlyMessage() };

  const repo = creds.repo;
  const patch = String(input.patch ?? "").trim();
  if (!patch) return { ok: false, message: "Not executed: patch is empty." };

  try {
    const parsed = parseUnifiedDiff(patch);
    const files = parsed.files;
    if (files.length === 0) {
      if (parsed.sawHunkHeader) {
        return {
          ok: false,
          message:
            "Not executed: patch has hunk headers but no file headers. Include one of: 'diff --git a/... b/...', '---/+++', or '*** Update File: ...'.",
        };
      }
      return { ok: false, message: "Not executed: patch contained no hunks." };
    }
    if (files.length > 10) {
      return { ok: false, message: "Not executed: patch touches too many files (max 10)." };
    }

    const branchRef = await getRef(creds.token, repo, input.branch);
    const commitSha = branchRef.object.sha;
    const commit = await getCommit(creds.token, repo, commitSha);
    const baseTreeSha = commit.tree.sha;

    const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    const changedFiles: string[] = [];

    for (const f of files) {
      const original = await getFileContent(creds.token, repo, f.path, input.branch);
      const updated = applyHunksToText(original, f.hunks);
      if (updated === original) continue;
      const blob = await createBlob(creds.token, repo, updated);
      treeEntries.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
      changedFiles.push(f.path);
    }

    if (treeEntries.length === 0) {
      return { ok: true, message: "No changes to apply (patch resulted in identical content)." };
    }

    const tree = await createTree(creds.token, repo, baseTreeSha, treeEntries);
    const newCommit = await createCommit(
      creds.token,
      repo,
      input.message,
      tree.sha,
      commitSha,
      creds.author
    );
    await updateRef(creds.token, repo, input.branch, newCommit.sha);

    return {
      ok: true,
      message: `Applied patch to ${changedFiles.length} file(s) and committed: ${input.message}`,
      metadata: {
        files: changedFiles,
        artifacts: changedFiles.map((path) => ({
          tool: "github_apply_patch",
          kind: "code_change",
          path,
          ref: input.branch,
          metadata: { repo, message: input.message },
        })),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to apply patch: ${msg}` };
  }
}

export async function github_list_tree(
  input: { repo: string; ref?: string; pathPrefix?: string; recursive?: boolean },
  ctx?: GitHubToolContext | null
): Promise<GitHubToolResult> {
  const creds = await getTokenAndRepo(ctx ?? null, input.repo);
  if (!creds) {
    return { ok: false, message: noAccessMessage() };
  }
  if ("error" in creds) return { ok: false, message: creds.error };
  const repo = creds.repo;

  try {
    const ref = input.ref?.trim() || creds.defaultBranch;
    const baseRef = await getRef(creds.token, repo, ref);
    const commitSha = baseRef.object.sha;
    const commit = await getCommit(creds.token, repo, commitSha);
    const treeSha = commit.tree.sha;
    const tree = await getTree(creds.token, repo, treeSha, Boolean(input.recursive ?? true));
    const prefix = (input.pathPrefix ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
    const items = tree.tree
      .filter((t) => (prefix ? String(t.path ?? "").startsWith(prefix + "/") || String(t.path ?? "") === prefix : true))
      .slice(0, 500)
      .map((t) => ({ path: t.path, type: t.type, sha: t.sha, size: (t as any).size }));
    return {
      ok: true,
      message: `Listed ${items.length} entries at ${ref}${prefix ? ` under ${prefix}/` : ""}.`,
      metadata: { ref, pathPrefix: prefix || null, items },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to list tree: ${msg}` };
  }
}

export async function github_search_code(
  input: { repo: string; query: string },
  ctx?: GitHubToolContext | null
): Promise<GitHubToolResult> {
  const creds = await getTokenAndRepo(ctx ?? null, input.repo);
  if (!creds) {
    return { ok: false, message: noAccessMessage() };
  }
  if ("error" in creds) return { ok: false, message: creds.error };
  const repo = creds.repo;

  try {
    // searchCode already appends repo:<owner/name>; strip caller-provided repo qualifiers
    // so queries remain stable across conversation turns.
    const cleanedQuery = String(input.query ?? "")
      .replace(/\brepo:[^\s]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const results = await searchCode(creds.token, repo, cleanedQuery);
    return {
      ok: true,
      message: `Search returned ${results.length} results.`,
      metadata: { query: cleanedQuery, results },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to search code: ${msg}` };
  }
}
