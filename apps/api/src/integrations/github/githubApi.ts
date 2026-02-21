/**
 * Real GitHub REST API calls. Uses installation access token.
 */

export async function githubApi(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub API ${method} ${path}: ${res.status} ${text}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function getRef(token: string, repo: string, ref: string): Promise<{ object: { sha: string } }> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`Invalid repo format: ${repo}`);
  const r = await githubApi(
    token,
    "GET",
    `/repos/${owner}/${name}/git/ref/${ref.startsWith("refs/") ? ref : `heads/${ref}`}`
  );
  return r as { object: { sha: string } };
}

export async function getCommit(token: string, repo: string, sha: string): Promise<{ tree: { sha: string } }> {
  const [owner, name] = repo.split("/");
  const r = await githubApi(token, "GET", `/repos/${owner}/${name}/git/commits/${sha}`);
  return r as { tree: { sha: string } };
}

export async function createBlob(token: string, repo: string, content: string): Promise<{ sha: string }> {
  const [owner, name] = repo.split("/");
  const r = await githubApi(token, "POST", `/repos/${owner}/${name}/git/blobs`, {
    content: Buffer.from(content).toString("base64"),
    encoding: "base64",
  });
  return r as { sha: string };
}

export async function createTree(
  token: string,
  repo: string,
  baseTreeSha: string,
  tree: Array<{ path: string; mode: string; type: string; sha: string }>
): Promise<{ sha: string }> {
  const [owner, name] = repo.split("/");
  const r = await githubApi(token, "POST", `/repos/${owner}/${name}/git/trees`, {
    base_tree: baseTreeSha,
    tree,
  });
  return r as { sha: string };
}

export async function createCommit(
  token: string,
  repo: string,
  message: string,
  treeSha: string,
  parentSha: string,
  author: { name: string; email: string }
): Promise<{ sha: string }> {
  const [owner, name] = repo.split("/");
  const r = await githubApi(token, "POST", `/repos/${owner}/${name}/git/commits`, {
    message,
    tree: treeSha,
    parents: [parentSha],
    author,
    committer: author,
  });
  return r as { sha: string };
}

export async function updateRef(
  token: string,
  repo: string,
  ref: string,
  sha: string,
  force = false
): Promise<unknown> {
  const [owner, name] = repo.split("/");
  return githubApi(token, "PATCH", `/repos/${owner}/${name}/git/refs/heads/${ref}`, {
    sha,
    force,
  });
}

export async function createRef(
  token: string,
  repo: string,
  ref: string,
  sha: string
): Promise<unknown> {
  const [owner, name] = repo.split("/");
  return githubApi(token, "POST", `/repos/${owner}/${name}/git/refs`, {
    ref: `refs/heads/${ref}`,
    sha,
  });
}

export async function createPullRequest(
  token: string,
  repo: string,
  title: string,
  head: string,
  base: string,
  body?: string
): Promise<{ html_url: string; number: number }> {
  const [owner, name] = repo.split("/");
  const r = await githubApi(token, "POST", `/repos/${owner}/${name}/pulls`, {
    title,
    head,
    base,
    body: body ?? "",
  });
  return r as { html_url: string; number: number };
}
