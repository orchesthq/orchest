import { getGitHubInstallationByClientId, deleteKbChunksForFile } from "../db/schema";
import { getValidInstallationToken } from "../integrations/github/githubService";
import { getCommit, getRef, getTree, getBlobContentBytes, getFileContentBytes } from "../integrations/github/githubApi";
import { ensureKbGitHubSource, indexFileToKb } from "./kbService";

const DEFAULT_MAX_FILE_BYTES = 300_000;

function isProbablyTextFile(path: string): boolean {
  const p = path.toLowerCase();
  if (p.includes("node_modules/") || p.includes("/dist/") || p.includes("/build/") || p.includes(".next/")) return false;
  if (p.endsWith(".png") || p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".gif") || p.endsWith(".pdf")) return false;
  if (p.endsWith(".zip") || p.endsWith(".tar") || p.endsWith(".gz") || p.endsWith(".woff") || p.endsWith(".woff2")) return false;
  return (
    p.endsWith(".md") ||
    p.endsWith(".txt") ||
    p.endsWith(".ts") ||
    p.endsWith(".tsx") ||
    p.endsWith(".js") ||
    p.endsWith(".jsx") ||
    p.endsWith(".json") ||
    p.endsWith(".yml") ||
    p.endsWith(".yaml") ||
    p.endsWith(".sql") ||
    p.endsWith(".py") ||
    p.endsWith(".go") ||
    p.endsWith(".java") ||
    p.endsWith(".rb") ||
    p.endsWith(".rs") ||
    p.endsWith(".toml") ||
    p.endsWith(".env") ||
    p.endsWith(".env.example")
  );
}

export async function syncGitHubRepoPathsToKb(input: {
  clientId: string;
  repoFullName: string;
  ref: string;
  sha: string;
  changedPaths: string[];
  removedPaths?: string[];
  maxFileBytes?: number;
}): Promise<{ indexedFiles: number; chunks: number; removedFiles: number }> {
  const repo = input.repoFullName.trim();
  const ref = input.ref.trim() || "main";
  const sha = String(input.sha ?? "").trim();
  if (!repo) throw new Error("repoFullName is required");
  if (!sha) throw new Error("sha is required");

  const installation = await getGitHubInstallationByClientId(input.clientId);
  if (!installation) throw new Error("GitHub is not connected for this client.");
  const token = await getValidInstallationToken(installation.installation_id);

  const source = await ensureKbGitHubSource({
    clientId: input.clientId,
    repoFullName: repo,
    ref,
    lastSyncedSha: sha,
  });

  const maxBytes = Math.min(Math.max(input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES, 10_000), 2_000_000);

  let removedFiles = 0;
  for (const p of input.removedPaths ?? []) {
    try {
      removedFiles += await deleteKbChunksForFile({ clientId: input.clientId, sourceId: source.id, path: p });
    } catch {
      // ignore
    }
  }

  let indexedFiles = 0;
  let chunks = 0;
  const paths = Array.from(new Set(input.changedPaths)).slice(0, 400);
  for (const p of paths) {
    if (!isProbablyTextFile(p)) continue;
    try {
      const { bytes, size } = await getFileContentBytes(token, repo, p, sha);
      if (size > maxBytes) continue;
      const text = bytes.toString("utf8");
      const r = await indexFileToKb({
        clientId: input.clientId,
        source,
        path: p,
        text,
      });
      indexedFiles += 1;
      chunks += r.chunks;
    } catch {
      // ignore individual file errors (deleted/binary/encoding/etc.)
    }
  }

  return { indexedFiles, chunks, removedFiles };
}

export async function syncGitHubRepoToKb(input: {
  clientId: string;
  repoFullName: string;
  ref?: string; // branch or refs/...
  maxFiles?: number;
  maxFileBytes?: number;
  paths?: string[]; // if provided, only sync these paths
}): Promise<{ repo: string; ref: string; sha: string; indexedFiles: number; chunks: number }> {
  const repo = input.repoFullName.trim();
  if (!repo.includes("/")) throw new Error("repoFullName must be like 'owner/name'");
  const ref = (input.ref ?? "main").trim() || "main";

  const installation = await getGitHubInstallationByClientId(input.clientId);
  if (!installation) throw new Error("GitHub is not connected for this client.");
  const token = await getValidInstallationToken(installation.installation_id);

  const refObj = await getRef(token, repo, ref);
  const commit = await getCommit(token, repo, refObj.object.sha);
  const tree = await getTree(token, repo, commit.tree.sha, true);

  const maxFiles = Math.min(Math.max(input.maxFiles ?? 200, 1), 2000);
  const maxBytes = Math.min(Math.max(input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES, 10_000), 2_000_000);

  const requested = input.paths ? new Set(input.paths.map((p) => p.replace(/^[\\/]+/, ""))) : null;

  const files = (tree.tree ?? []).filter((t) => t.type === "blob" && typeof t.path === "string" && t.path.length > 0);
  const candidates = files
    .filter((f) => (requested ? requested.has(f.path) : true))
    .filter((f) => isProbablyTextFile(f.path))
    .slice(0, maxFiles);

  const source = await ensureKbGitHubSource({
    clientId: input.clientId,
    repoFullName: repo,
    ref,
    lastSyncedSha: refObj.object.sha,
  });

  let indexedFiles = 0;
  let chunks = 0;

  for (const f of candidates) {
    if (typeof f.sha !== "string" || !f.sha) continue;
    try {
      const { bytes, size } = await getBlobContentBytes(token, repo, f.sha);
      if (size > maxBytes) continue;
      const text = bytes.toString("utf8");
      const r = await indexFileToKb({
        clientId: input.clientId,
        source,
        path: f.path,
        text,
      });
      indexedFiles += 1;
      chunks += r.chunks;
    } catch {
      // ignore individual file errors (binary/encoding/etc.)
    }
  }

  return { repo, ref, sha: refObj.object.sha, indexedFiles, chunks };
}

