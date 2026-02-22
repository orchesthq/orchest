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
import { getAgentGitHubConnection, getValidInstallationToken } from "./githubService";
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

async function getTokenAndRepo(ctx: GitHubToolContext | null): Promise<{
  token: string;
  repo: string;
  author: { name: string; email: string };
  defaultBranch: string;
  accessLevel: string;
} | null> {
  if (!ctx) return null;
  const connection = await getAgentGitHubConnection(ctx.clientId, ctx.agentId);
  if (!connection || !connection.default_repo) return null;

  const installation = await getGitHubInstallationById(connection.github_installation_id);
  if (!installation) return null;

  const token = await getValidInstallationToken(installation.installation_id);
  return {
    token,
    repo: connection.default_repo,
    author: {
      name: connection.commit_author_name,
      email: connection.commit_author_email,
    },
    defaultBranch: connection.default_branch,
    accessLevel: connection.access_level,
  };
}

function noAccessMessage(): string {
  return "Not executed: this agent is not linked to GitHub, or no repository is configured. Link the agent to GitHub in the Orchest dashboard and specify a repository.";
}

function readOnlyMessage(): string {
  return "Not executed: this agent has read-only access. Configure write or PR access in the Orchest dashboard.";
}

export async function create_branch(
  input: { repo: string; base: string; branch: string },
  ctx?: GitHubToolContext | null
): Promise<GitHubToolResult> {
  const creds = await getTokenAndRepo(ctx ?? null);
  if (!creds) {
    return { ok: false, message: noAccessMessage() };
  }
  if (creds.accessLevel === "read") {
    return { ok: false, message: readOnlyMessage() };
  }

  const repo = input.repo || creds.repo;
  if (repo !== creds.repo) {
    return { ok: false, message: `Not executed: agent is linked to ${creds.repo}, not ${repo}.` };
  }

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
  const creds = await getTokenAndRepo(ctx ?? null);
  if (!creds) {
    return { ok: false, message: noAccessMessage() };
  }
  if (creds.accessLevel === "read") {
    return { ok: false, message: readOnlyMessage() };
  }

  const repo = input.repo || creds.repo;
  if (repo !== creds.repo) {
    return { ok: false, message: `Not executed: agent is linked to ${creds.repo}, not ${repo}.` };
  }

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
  const creds = await getTokenAndRepo(ctx ?? null);
  if (!creds) {
    return { ok: false, message: noAccessMessage() };
  }
  if (creds.accessLevel === "read") {
    return { ok: false, message: readOnlyMessage() };
  }

  const repo = input.repo || creds.repo;
  if (repo !== creds.repo) {
    return { ok: false, message: `Not executed: agent is linked to ${creds.repo}, not ${repo}.` };
  }

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
  const creds = await getTokenAndRepo(ctx ?? null);
  if (!creds) {
    return { ok: false, message: noAccessMessage() };
  }
  const repo = input.repo || creds.repo;
  if (repo !== creds.repo) {
    return { ok: false, message: `Not executed: agent is linked to ${creds.repo}, not ${repo}.` };
  }

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
  const creds = await getTokenAndRepo(ctx ?? null);
  if (!creds) {
    return { ok: false, message: noAccessMessage() };
  }
  const repo = input.repo || creds.repo;
  if (repo !== creds.repo) {
    return { ok: false, message: `Not executed: agent is linked to ${creds.repo}, not ${repo}.` };
  }

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
  const creds = await getTokenAndRepo(ctx ?? null);
  if (!creds) {
    return { ok: false, message: noAccessMessage() };
  }
  const repo = input.repo || creds.repo;
  if (repo !== creds.repo) {
    return { ok: false, message: `Not executed: agent is linked to ${creds.repo}, not ${repo}.` };
  }

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
