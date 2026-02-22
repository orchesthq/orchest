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

export async function getFileContent(token: string, repo: string, path: string, ref?: string): Promise<string> {
  const [owner, name] = repo.split("/");
  const qp = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const r = (await githubApi(
    token,
    "GET",
    `/repos/${owner}/${name}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}${qp}`
  )) as any;

  // GitHub returns either an object for a file or an array for a directory.
  if (!r || Array.isArray(r)) {
    throw new Error(`Path is not a file: ${path}`);
  }
  const encoding = String(r.encoding ?? "");
  const content = String(r.content ?? "");
  if (encoding !== "base64") {
    throw new Error(`Unsupported content encoding: ${encoding || "unknown"}`);
  }
  // GitHub may include newlines in base64 content.
  const b64 = content.replace(/\s+/g, "");
  return Buffer.from(b64, "base64").toString("utf8");
}

export async function getFileContentBytes(
  token: string,
  repo: string,
  path: string,
  ref?: string
): Promise<{ bytes: Buffer; size: number }> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`Invalid repo format: ${repo}`);
  const qp = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const r = (await githubApi(
    token,
    "GET",
    `/repos/${owner}/${name}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}${qp}`
  )) as any;

  if (!r || Array.isArray(r)) {
    throw new Error(`Path is not a file: ${path}`);
  }
  const encoding = String(r.encoding ?? "");
  const content = String(r.content ?? "");
  const size = Number(r.size ?? 0);
  if (encoding !== "base64") {
    throw new Error(`Unsupported content encoding: ${encoding || "unknown"}`);
  }
  const b64 = content.replace(/\s+/g, "");
  const bytes = Buffer.from(b64, "base64");
  return { bytes, size: Number.isFinite(size) && size > 0 ? size : bytes.length };
}

export async function getBlobContentBytes(
  token: string,
  repo: string,
  sha: string
): Promise<{ bytes: Buffer; size: number }> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`Invalid repo format: ${repo}`);
  const r = (await githubApi(token, "GET", `/repos/${owner}/${name}/git/blobs/${sha}`)) as any;
  const encoding = String(r?.encoding ?? "");
  const content = String(r?.content ?? "");
  const size = Number(r?.size ?? 0);
  if (encoding !== "base64") {
    throw new Error(`Unsupported blob encoding: ${encoding || "unknown"}`);
  }
  const b64 = content.replace(/\s+/g, "");
  const bytes = Buffer.from(b64, "base64");
  return { bytes, size: Number.isFinite(size) && size > 0 ? size : bytes.length };
}

export async function compareCommits(
  token: string,
  repo: string,
  base: string,
  head: string
): Promise<{ files: Array<{ filename: string; status: string; additions: number; deletions: number; changes: number }> }> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`Invalid repo format: ${repo}`);
  const r = (await githubApi(token, "GET", `/repos/${owner}/${name}/compare/${base}...${head}`)) as any;
  const files: any[] = Array.isArray(r?.files) ? r.files : [];
  return {
    files: files.map((f) => ({
      filename: String(f.filename ?? ""),
      status: String(f.status ?? ""),
      additions: Number(f.additions ?? 0),
      deletions: Number(f.deletions ?? 0),
      changes: Number(f.changes ?? 0),
    })),
  };
}

export async function getTree(
  token: string,
  repo: string,
  treeSha: string,
  recursive = false
): Promise<{ tree: Array<{ path: string; type: string; sha: string; size?: number }> }> {
  const [owner, name] = repo.split("/");
  const qp = recursive ? "?recursive=1" : "";
  const r = await githubApi(token, "GET", `/repos/${owner}/${name}/git/trees/${treeSha}${qp}`);
  return r as { tree: Array<{ path: string; type: string; sha: string; size?: number }> };
}

export async function searchCode(
  token: string,
  repo: string,
  query: string
): Promise<Array<{ path: string; sha: string; score: number }>> {
  const q = `${query} repo:${repo}`;
  const r = (await githubApi(token, "GET", `/search/code?q=${encodeURIComponent(q)}&per_page=20`)) as any;
  const items: any[] = Array.isArray(r?.items) ? r.items : [];
  return items.map((i) => ({
    path: String(i.path ?? ""),
    sha: String(i.sha ?? ""),
    score: Number(i.score ?? 0),
  }));
}
