import crypto from "crypto";
import ts from "typescript";
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
  symbol?: string | null;
  kind?: string | null;
  language?: string | null;
};

export function chunkTextByLines(input: {
  path: string;
  text: string;
  maxLines?: number;
  overlapLines?: number;
  symbol?: string | null;
  kind?: string | null;
  language?: string | null;
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
        symbol: input.symbol ?? null,
        kind: input.kind ?? null,
        language: input.language ?? null,
      });
    }
    if (end >= lines.length) break;
    i = end - overlap;
  }

  return out;
}

function languageFromPath(path: string): string | null {
  const p = path.toLowerCase();
  if (p.endsWith(".ts") || p.endsWith(".tsx")) return "typescript";
  if (p.endsWith(".js") || p.endsWith(".jsx")) return "javascript";
  if (p.endsWith(".md")) return "markdown";
  if (p.endsWith(".sql")) return "sql";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".yml") || p.endsWith(".yaml")) return "yaml";
  return null;
}

function isTsLike(path: string): boolean {
  const p = path.toLowerCase();
  return p.endsWith(".ts") || p.endsWith(".tsx") || p.endsWith(".js") || p.endsWith(".jsx");
}

function exportedDeclarationName(node: ts.Node): string | null {
  const anyNode: any = node as any;
  if (typeof anyNode.name?.text === "string") return anyNode.name.text;
  return null;
}

function nodeKind(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isVariableStatement(node)) return "variable";
  if (ts.isExportAssignment(node)) return "export_default";
  return "node";
}

function hasExportModifier(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as any) & ts.ModifierFlags.Export) !== 0;
}

function sliceLines(text: string, startLine: number, endLine: number): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, startLine - 1), Math.min(lines.length, endLine)).join("\n").trim();
}

export function chunkTextCodeAware(input: { path: string; text: string }): KbChunkInput[] {
  const language = languageFromPath(input.path);
  const text = String(input.text ?? "");
  if (!isTsLike(input.path)) {
    return chunkTextByLines({ path: input.path, text, language });
  }

  try {
    const sf = ts.createSourceFile(input.path, text, ts.ScriptTarget.Latest, true);
    const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

    const chunks: KbChunkInput[] = [];

    for (const stmt of sf.statements) {
      // Top-level exported declarations are the most useful “units”.
      if (!hasExportModifier(stmt) && !ts.isExportAssignment(stmt)) continue;

      const start = lineOf(stmt.getStart(sf, false));
      const end = lineOf(stmt.end);
      const symbol = exportedDeclarationName(stmt);
      const kind = nodeKind(stmt);

      // If the exported node is huge, fall back to line chunking within its range.
      if (end - start > 420) {
        const subset = sliceLines(text, start, end);
        chunks.push(
          ...chunkTextByLines({
            path: input.path,
            text: subset,
            maxLines: 200,
            overlapLines: 30,
            symbol: symbol ?? null,
            kind,
            language,
          }).map((c) => ({
            ...c,
            // Fix up line numbers relative to original file.
            startLine: c.startLine + (start - 1),
            endLine: c.endLine + (start - 1),
          }))
        );
      } else {
        const content = sliceLines(text, start, end);
        if (!content) continue;
        chunks.push({
          path: input.path,
          startLine: start,
          endLine: end,
          content,
          symbol: symbol ?? null,
          kind,
          language,
        });
      }
    }

    // If we found nothing exported, fall back to line chunking.
    if (chunks.length === 0) {
      return chunkTextByLines({ path: input.path, text, language });
    }

    return chunks;
  } catch {
    return chunkTextByLines({ path: input.path, text, language });
  }
}

export async function indexFileToKb(input: {
  clientId: string;
  source: KbSourceRow;
  path: string;
  text: string;
}): Promise<{ chunks: number }> {
  const chunks = chunkTextCodeAware({ path: input.path, text: input.text });

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
      symbol: c.symbol ?? null,
      kind: c.kind ?? null,
      language: c.language ?? null,
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

