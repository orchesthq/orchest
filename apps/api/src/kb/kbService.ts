import crypto from "crypto";
import { embedText } from "../services/openaiService";
import {
  deleteKbChunksForFile,
  insertKbChunk,
  searchKbChunksByEmbedding,
  upsertKbSource,
  type KbSourceRow,
} from "../db/schema";

export function toPgVectorLiteral(v: number[]): string {
  // pgvector input format: '[1,2,3]'
  // Ensure finite numbers only.
  const nums = v.filter((n) => Number.isFinite(n)).map((n) => Number(n));
  return `[${nums.join(",")}]`;
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export type KbChunkInput = {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
};

export function chunkTextByLines(input: {
  path: string;
  text: string;
  maxLines?: number;
  overlapLines?: number;
}): KbChunkInput[] {
  const maxLines = Math.min(Math.max(input.maxLines ?? 160, 40), 400);
  const overlap = Math.min(Math.max(input.overlapLines ?? 20, 0), Math.floor(maxLines / 2));
  const lines = String(input.text ?? "").split(/\r?\n/);
  const out: KbChunkInput[] = [];

  let i = 0;
  while (i < lines.length) {
    const start = i;
    const end = Math.min(lines.length, i + maxLines);
    const content = lines.slice(start, end).join("\n").trim();
    if (content) {
      out.push({
        path: input.path,
        startLine: start + 1,
        endLine: end,
        content,
      });
    }
    if (end >= lines.length) break;
    i = end - overlap;
  }

  return out;
}

export async function indexFileToKb(input: {
  clientId: string;
  source: KbSourceRow;
  path: string;
  text: string;
}): Promise<{ chunks: number }> {
  const chunks = chunkTextByLines({ path: input.path, text: input.text });

  await deleteKbChunksForFile({
    clientId: input.clientId,
    sourceId: input.source.id,
    path: input.path,
  });

  let inserted = 0;
  for (const c of chunks) {
    const hash = sha256(c.content);
    const embedded = await embedText({ text: c.content }).catch(() => null);
    const embLiteral = embedded ? toPgVectorLiteral(embedded.embedding) : null;

    await insertKbChunk({
      clientId: input.clientId,
      sourceId: input.source.id,
      path: c.path,
      startLine: c.startLine,
      endLine: c.endLine,
      content: c.content,
      contentHash: hash,
      embedding: embLiteral,
      tokenCount: null,
    });
    inserted += 1;
  }

  return { chunks: inserted };
}

export async function ensureKbGitHubSource(input: {
  clientId: string;
  repoFullName: string;
  ref: string;
  lastSyncedSha?: string | null;
}): Promise<KbSourceRow> {
  return await upsertKbSource({
    clientId: input.clientId,
    provider: "github",
    repoFullName: input.repoFullName,
    ref: input.ref,
    lastSyncedSha: input.lastSyncedSha ?? null,
  });
}

export async function kbSearch(input: {
  clientId: string;
  query: string;
  limit?: number;
  repoFullName?: string;
  pathPrefix?: string;
}): Promise<
  Array<{
    repo: string;
    ref: string;
    path: string;
    startLine: number;
    endLine: number;
    content: string;
    distance: number;
  }>
> {
  const embedded = await embedText({ text: input.query }).catch(() => null);
  if (!embedded) return [];

  const matches = await searchKbChunksByEmbedding({
    clientId: input.clientId,
    embedding: toPgVectorLiteral(embedded.embedding),
    limit: input.limit ?? 8,
    repoFullName: input.repoFullName,
    pathPrefix: input.pathPrefix,
  });

  return matches.map((m) => ({
    repo: m.source.repo_full_name,
    ref: m.source.ref,
    path: m.chunk.path,
    startLine: m.chunk.start_line,
    endLine: m.chunk.end_line,
    content: m.chunk.content,
    distance: m.distance,
  }));
}

