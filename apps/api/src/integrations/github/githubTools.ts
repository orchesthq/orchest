import {
  createBlob,
  createCommit,
  createPullRequest,
  createRef,
  createTree,
  getCommit,
  getFileContent,
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
    return { ok: true, message: `Created branch '${input.branch}' from '${input.base}'.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/reference already exists|already exists/i.test(msg)) {
      return { ok: true, message: `Branch '${input.branch}' already exists, proceeding.` };
    }
    return { ok: false, message: `Failed to create branch: ${msg}` };
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

    return { ok: true, message: `Created ${input.path} and committed: ${input.message}` };
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
      metadata: { url: pr.html_url, number: pr.number },
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
    const content = await getFileContent(creds.token, repo, input.path, ref);
    const truncated = content.length > 40_000 ? content.slice(0, 40_000) + "\n\n[truncated]" : content;
    return {
      ok: true,
      message: `Read ${input.path} at ${ref} (${content.length} chars).`,
      metadata: { path: input.path, ref, content: truncated },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to read file: ${msg}` };
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
    const results = await searchCode(creds.token, repo, input.query);
    return {
      ok: true,
      message: `Search returned ${results.length} results.`,
      metadata: { query: input.query, results },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to search code: ${msg}` };
  }
}
