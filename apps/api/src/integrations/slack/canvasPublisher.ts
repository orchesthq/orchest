import { slackApi, slackApiGet } from "./slackApiClient";

function deriveCanvasTitle(input: { taskText: string; agentName: string }): string {
  const raw = String(input.taskText ?? "").replace(/\s+/g, " ").trim();
  const lower = raw.toLowerCase();
  let title = "";

  if (lower.includes("intro") || lower.includes("introduction") || lower.includes("about yourself") || lower.includes("about you")) {
    title = `Introduction — ${input.agentName}`;
  } else if (lower.includes("how to work with")) {
    title = `How to work with ${input.agentName}`;
  } else if (lower.includes("canvas")) {
    title = `${input.agentName} — Canvas`;
  } else {
    title = raw.slice(0, 80) || `${input.agentName} — Canvas`;
  }

  // Slack title length guardrail.
  if (title.length > 120) title = title.slice(0, 120);
  return title;
}

function extractFirstH1(markdown: string): string | null {
  const lines = String(markdown ?? "").split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s*#\s+(.+?)\s*$/.exec(line);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function normalizeCanvasTitle(s: string): string {
  let t = String(s ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return "";
  // Keep it short and avoid raw chatty prompts becoming the title.
  t = t.replace(/^(hi|hello|hey)\b[,!.\s]*/i, "").trim();
  if (t.length > 80) t = t.slice(0, 79).trimEnd() + "…";
  return t;
}

function extractNumberedOptions(markdown: string): string[] {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const m = /^\s*(?:\(?\s*\d+\s*\)?\s*[).:-])\s+(.+?)\s*$/.exec(line);
    if (!m?.[1]) continue;
    const text = m[1].trim();
    if (text.length < 3) continue;
    out.push(text);
    if (out.length >= 5) break;
  }
  return out;
}

function ensureCanvasDocStructure(input: { title: string; markdown: string; taskText: string }): string {
  const trimmed = String(input.markdown ?? "").trim();
  const hasH1 = /^\s*#\s+\S/m.test(trimmed);
  const hasSummary = /^\s*##\s+Summary\b/im.test(trimmed);

  // If it already looks like a doc with a summary, leave it alone.
  if (hasH1 && hasSummary) return trimmed;

  const titleLine = `# ${input.title}`.trim();
  const summaryLines: string[] = [];
  summaryLines.push("## Summary");

  const opts = extractNumberedOptions(trimmed);
  if (opts.length > 0) {
    summaryLines.push("This document covers these options:");
    for (const o of opts.slice(0, 3)) summaryLines.push(`- ${o}`);
  } else {
    const ctx = normalizeCanvasTitle(input.taskText);
    summaryLines.push(ctx ? ctx : "Context and summary.");
  }

  const header = [hasH1 ? "" : titleLine, "", ...summaryLines, ""].filter(Boolean).join("\n");

  if (!hasH1) return `${header}\n${trimmed}`.trim();

  // Has H1 but no Summary: insert Summary block after the first H1.
  const lines = trimmed.split(/\r?\n/);
  const h1Idx = lines.findIndex((l) => /^\s*#\s+\S/.test(l));
  if (h1Idx < 0) return `${header}\n${trimmed}`.trim();

  const before = lines.slice(0, h1Idx + 1).join("\n").trimEnd();
  const after = lines.slice(h1Idx + 1).join("\n").trimStart();
  return `${before}\n\n${summaryLines.join("\n")}\n\n${after}`.trim();
}

export function buildCanvasTitleAndMarkdown(input: {
  taskText: string;
  agentName: string;
  documentMarkdown: string;
  titleOverride?: string | null;
}): { title: string; markdown: string } {
  const h1 = extractFirstH1(input.documentMarkdown);
  const fallback = deriveCanvasTitle({ taskText: input.taskText, agentName: input.agentName });
  const title = normalizeCanvasTitle(input.titleOverride ?? h1 ?? fallback) || `${input.agentName} — Canvas`;
  const markdown = ensureCanvasDocStructure({
    title,
    markdown: input.documentMarkdown,
    taskText: input.taskText,
  });
  return { title, markdown };
}

export function stripCanvasDisclaimers(markdown: string): string {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const out: string[] = [];
  let droppedLeading = 0;

  const isDisclaimerLine = (s: string) =>
    /can'?t\s+directly\s+create\s+.*canvas/i.test(s) ||
    /no\s+slack\s+(ui|api)\s+access/i.test(s) ||
    /paste-?ready/i.test(s) ||
    /copy\/paste/i.test(s);

  for (const line of lines) {
    const trimmed = line.trim();
    if (out.length === 0 && droppedLeading < 12 && trimmed && isDisclaimerLine(trimmed)) {
      droppedLeading += 1;
      continue;
    }
    out.push(line);
  }

  // Also drop an immediate following blank line block if we dropped something.
  while (droppedLeading > 0 && out.length > 0 && out[0]?.trim() === "") out.shift();
  return out.join("\n").trim();
}

export function splitSlackConversationAndDocument(markdown: string): { conversation: string; document: string } {
  const cleaned = stripCanvasDisclaimers(markdown);
  const lines = cleaned.split(/\r?\n/);

  // Document should start at the first markdown heading. Encourage agents to start docs with "# ..."
  const headingIdx = lines.findIndex((l) => /^\s{0,3}#{1,6}\s+\S/.test(l));
  if (headingIdx <= 0) {
    // If there's no heading, treat everything as the document and keep conversation empty.
    return { conversation: "", document: cleaned };
  }

  const convo = lines.slice(0, headingIdx).join("\n").trim();
  const doc = lines.slice(headingIdx).join("\n").trim();
  return { conversation: convo, document: doc || cleaned };
}

export async function createSlackCanvasFromMarkdown(input: {
  token: string;
  title: string;
  markdown: string;
  channelId?: string;
}): Promise<{ canvasId: string; url?: string }> {
  const maxMarkdown = 95_000;
  const markdown =
    input.markdown.length > maxMarkdown ? input.markdown.slice(0, maxMarkdown) + "\n\n[truncated]" : input.markdown;
  const doc = { type: "markdown", markdown };

  const tryFilesInfo = async (canvasId: string): Promise<{ canvasId: string; url?: string }> => {
    try {
      const info = await slackApiGet(input.token, "files.info", { file: canvasId });
      const url: string | undefined = info?.file?.permalink;
      return { canvasId, url };
    } catch {
      return { canvasId };
    }
  };

  const tryBuildCanvasUrl = async (canvasId: string): Promise<string | undefined> => {
    // Fallback: construct a docs URL using the workspace URL from auth.test.
    // Slack canvas examples use: https://<workspace>.slack.com/docs/<TEAM_ID>/<CANVAS_ID>
    try {
      const auth = await slackApiGet(input.token, "auth.test", {});
      const baseUrl: string | undefined = auth?.url;
      const teamId: string | undefined = auth?.team_id;
      if (!baseUrl || !teamId) return undefined;
      return `${String(baseUrl).replace(/\/+$/, "")}/docs/${teamId}/${canvasId}`;
    } catch {
      return undefined;
    }
  };

  const isChannel = Boolean(input.channelId && /^[CG]/.test(input.channelId));
  if (isChannel && input.channelId) {
    try {
      const created = await slackApi(input.token, "conversations.canvases.create", {
        channel_id: input.channelId,
        document_content: doc,
      });
      const canvasId: string | undefined = created?.canvas_id ?? created?.canvas?.id ?? created?.id;
      if (canvasId) return await tryFilesInfo(canvasId);
    } catch (err) {
      // If a canvas already exists for this channel, update it in-place.
      const msg = err instanceof Error ? err.message : String(err);
      if (/channel_canvas_already_exists/i.test(msg)) {
        const info = await slackApi(input.token, "conversations.info", { channel: input.channelId });
        const existing: string | undefined =
          info?.channel?.properties?.canvas?.file_id ??
          info?.channel?.properties?.canvas?.id ??
          info?.channel?.properties?.canvas ??
          undefined;
        if (existing) {
          await slackApi(input.token, "canvases.edit", {
            canvas_id: existing,
            changes: [{ operation: "replace", document_content: doc }],
          });
          return await tryFilesInfo(existing);
        }
      }
      // Fall through to standalone canvas attempt below.
    }
  }

  const created = await slackApi(input.token, "canvases.create", {
    title: input.title,
    document_content: doc,
    // If we have a real channel id, attach it so access is inherited.
    channel_id: isChannel ? input.channelId : undefined,
  });

  const canvasId: string | undefined = created?.canvas_id ?? created?.canvas?.id ?? created?.id;
  if (!canvasId) return { canvasId: "" };
  const info = await tryFilesInfo(canvasId);
  if (info.url) return info;
  const fallback = await tryBuildCanvasUrl(canvasId);
  return { canvasId, url: fallback };
}

