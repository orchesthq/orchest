import crypto from "crypto";
import { z } from "zod";
import {
  consumeSlackOauthState,
  createSlackOauthState,
  getAgentByIdScoped,
  listAgentMemoriesByTypeScoped,
  getSlackAgentLinkByDmChannelId,
  getSlackAgentLinkByTeamAndBotKey,
  getSlackInstallationByClientIdAndBotKey,
  getSlackInstallationByTeamIdAndApiAppId,
  listPartnerSettingsByPartner,
  upsertSlackAgentLink,
  upsertSlackInstallation,
  type SlackAgentLinkRow,
  type SlackInstallationRow,
} from "../../db/schema";
import { createTaskForAgentScoped } from "../../db/schema";
import { runAgentTask } from "../../agent/agentLoop";
import { generateSlackPlanAck, tryConversationalReply } from "../../services/openaiService";
import { isDbConfigured } from "../../db/client";

export class SlackConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlackConfigError";
  }
}

const slackBotAppSettingsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  signingSecret: z.string().min(1),
});
type SlackBotAppSettings = z.infer<typeof slackBotAppSettingsSchema>;

const SLACK_SETTINGS_CACHE_TTL_MS = 30_000;
let slackBotAppsCache:
  | {
      loadedAtMs: number;
      appsByBotKey: Record<string, SlackBotAppSettings>;
    }
  | undefined;

function requireSlackRedirectUri(): string {
  const v = process.env.SLACK_REDIRECT_URI;
  if (!v) throw new SlackConfigError("SLACK_REDIRECT_URI is not configured");
  return v;
}

async function loadSlackBotAppsFromDb(): Promise<Record<string, SlackBotAppSettings>> {
  const rows = await listPartnerSettingsByPartner("slack");
  const apps: Record<string, SlackBotAppSettings> = {};
  for (const r of rows) {
    if (!r.key || r.key === "defaults") continue;
    const parsed = slackBotAppSettingsSchema.safeParse(r.settings);
    if (!parsed.success) continue;
    apps[r.key] = parsed.data;
  }
  return apps;
}

async function getSlackBotAppsCached(): Promise<Record<string, SlackBotAppSettings>> {
  const now = Date.now();
  if (slackBotAppsCache && now - slackBotAppsCache.loadedAtMs < SLACK_SETTINGS_CACHE_TTL_MS) {
    return slackBotAppsCache.appsByBotKey;
  }

  let appsByBotKey: Record<string, SlackBotAppSettings> = {};

  if (isDbConfigured()) {
    try {
      appsByBotKey = await loadSlackBotAppsFromDb();
    } catch (err) {
      console.error("[slack] failed to load bot apps from DB", err);
    }
  }

  slackBotAppsCache = { loadedAtMs: now, appsByBotKey };
  return appsByBotKey;
}

export async function listSlackBotKeys(): Promise<string[]> {
  const apps = await getSlackBotAppsCached();
  const keys = Object.keys(apps).sort();
  if (keys.length === 0) throw new SlackConfigError("No Slack bot apps are configured");
  return keys;
}

export async function listSlackSigningSecrets(): Promise<string[]> {
  const apps = await getSlackBotAppsCached();
  const secrets = Object.values(apps)
    .map((a) => a.signingSecret)
    .filter(Boolean);
  if (secrets.length === 0) throw new SlackConfigError("No Slack signing secrets are configured");
  return secrets;
}

async function requireSlackBotApp(botKey: string): Promise<SlackBotAppSettings> {
  const apps = await getSlackBotAppsCached();
  const app = apps[botKey];
  if (!app) throw new SlackConfigError(`Slack bot app '${botKey}' is not configured`);
  return app;
}

export async function getSlackAuthorizeUrl(input: { botKey: string; state: string }): Promise<string> {
  const app = await requireSlackBotApp(input.botKey);
  const redirectUri = requireSlackRedirectUri();

  // Bot scopes needed for: events + messaging + persona customization + thread context + canvases.
  const scopes = [
    "chat:write",
    "chat:write.customize",
    "im:write",
    "channels:read",
    "channels:history",
    "groups:read",
    "groups:history",
    "im:read",
    "im:history",
    "mpim:read",
    "mpim:history",
    "app_mentions:read",
    "files:read",
    "canvases:write",
  ].join(",");

  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", app.clientId);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

export async function createSlackInstallState(input: {
  clientId: string;
  botKey: string;
  agentId?: string | null;
}): Promise<string> {
  const state = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await createSlackOauthState({
    clientId: input.clientId,
    botKey: input.botKey,
    agentId: input.agentId ?? null,
    state,
    expiresAt,
  });
  return state;
}

export type SlackOAuthCallbackResult = {
  installation: SlackInstallationRow;
  agentId: string | null;
};

export async function handleSlackOAuthCallback(input: {
  code: string;
  state: string;
}): Promise<SlackOAuthCallbackResult> {
  const record = await consumeSlackOauthState(input.state);
  if (!record) throw new Error("Invalid or expired Slack OAuth state");

  const clientId = record.client_id;
  const botKey = (record as any).bot_key ?? "orchest";
  const agentId = (record as any).agent_id ?? null;

  const app = await requireSlackBotApp(botKey);
  const redirectUri = requireSlackRedirectUri();

  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code: input.code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  const json = (await res.json()) as any;
  if (!json?.ok) {
    throw new Error(`Slack oauth.v2.access failed: ${json?.error ?? "unknown_error"}`);
  }

  const teamId: string = json.team?.id;
  const teamName: string | undefined = json.team?.name;
  const enterpriseId: string | undefined = json.enterprise?.id;
  const botUserId: string = json.bot_user_id;
  const botAccessToken: string = json.access_token;
  const installedByUserId: string = json.authed_user?.id;
  const apiAppId: string | undefined = json.app_id;

  const installation = await upsertSlackInstallation({
    clientId,
    botKey,
    teamId,
    apiAppId: apiAppId ?? null,
    teamName: teamName ?? null,
    enterpriseId: enterpriseId ?? null,
    botUserId,
    botAccessToken,
    installedByUserId,
  });
  return { installation, agentId };
}

export function verifySlackSignature(input: {
  signingSecret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: Buffer;
}): boolean {
  if (!input.timestamp || !input.signature) return false;

  // Prevent replay attacks (5 minutes).
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 60 * 5) return false;

  const base = `v0:${input.timestamp}:${input.rawBody.toString("utf8")}`;
  const hmac = crypto.createHmac("sha256", input.signingSecret).update(base).digest("hex");
  const expected = `v0=${hmac}`;

  return timingSafeEqual(expected, input.signature);
}

export function verifySlackSignatureAny(input: {
  signingSecrets: string[];
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: Buffer;
}): boolean {
  return input.signingSecrets.some((secret) =>
    verifySlackSignature({
      signingSecret: secret,
      timestamp: input.timestamp,
      signature: input.signature,
      rawBody: input.rawBody,
    })
  );
}

function timingSafeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function redactSlackPayload(payload: Record<string, any>): Record<string, any> {
  // Avoid logging large/private content. Keep only high-signal routing fields.
  const allow = [
    "channel",
    "channel_id",
    "thread_ts",
    "ts",
    "user",
    "team_id",
    "canvas_id",
    "title",
    "changes",
    "document_content",
    "file",
  ];

  const out: Record<string, any> = {};
  for (const k of allow) {
    if (!(k in payload)) continue;
    const v = payload[k];
    if (k === "changes" && Array.isArray(v)) {
      out[k] = { count: v.length, operations: v.map((c: any) => c?.operation).filter(Boolean).slice(0, 10) };
      continue;
    }
    if (k === "document_content" && v && typeof v === "object") {
      const md = typeof v.markdown === "string" ? v.markdown : "";
      out[k] = { type: v.type, markdown_length: md.length };
      continue;
    }
    if (typeof v === "string" && v.length > 200) out[k] = v.slice(0, 200) + "…";
    else out[k] = v;
  }
  return out;
}

async function slackApi(token: string, method: string, payload: Record<string, any>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const reqId = res.headers.get("x-slack-req-id") ?? undefined;
  const bodyText = await res.text();
  let json: any;
  try {
    json = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    throw new Error(
      `Slack API ${method} failed (${res.status})${reqId ? ` [req ${reqId}]` : ""}: non-JSON response: ${
        bodyText ? bodyText.slice(0, 800) : "(empty)"
      }`
    );
  }
  if (!json?.ok) {
    const err = String(json?.error ?? "unknown_error");
    const detail = json?.detail ? ` detail=${String(json.detail).slice(0, 500)}` : "";
    const meta = json?.response_metadata ? ` response_metadata=${JSON.stringify(json.response_metadata)}` : "";
    const needed = json?.needed ? ` needed=${String(json.needed)}` : "";
    const provided = json?.provided ? ` provided=${String(json.provided)}` : "";
    const payloadSummary = JSON.stringify(redactSlackPayload(payload));
    throw new Error(
      `Slack API ${method} failed (${res.status})${reqId ? ` [req ${reqId}]` : ""}: ${err}${detail}${needed}${provided} payload=${payloadSummary}${meta}`
    );
  }
  return json;
}

export async function enableAgentInSlack(input: {
  clientId: string;
  agentId: string;
  botKey: string;
  iconUrl?: string | null;
}): Promise<SlackAgentLinkRow> {
  const installation = await getSlackInstallationByClientIdAndBotKey({
    clientId: input.clientId,
    botKey: input.botKey,
  });
  if (!installation) throw new Error("Slack is not connected for this client");

  const agent = await getAgentByIdScoped(input.clientId, input.agentId);
  if (!agent) throw new Error("Agent not found for client");

  // Create/open a DM between the bot and the installing user.
  const open = await slackApi(installation.bot_access_token, "conversations.open", {
    users: installation.installed_by_user_id,
    return_im: true,
  });
  const dmChannelId: string | undefined = open?.channel?.id;
  if (!dmChannelId) throw new Error("Failed to open DM channel in Slack");

  const link = await upsertSlackAgentLink({
    clientId: input.clientId,
    agentId: input.agentId,
    teamId: installation.team_id,
    botKey: input.botKey,
    dmChannelId,
    displayName: agent.name,
    iconUrl: input.iconUrl ?? null,
  });

  // Onboarding message in the DM, using the agent persona.
  await slackApi(installation.bot_access_token, "chat.postMessage", {
    channel: dmChannelId,
    text: `Hi — I’m *${agent.name}* (${agent.role}). You can message me here any time with tasks. I’ll keep you updated as I work.`,
    username: agent.name,
    icon_url: input.iconUrl ?? undefined,
  });

  return link;
}

// Deduplicate events: Slack retries if it doesn't get 200 in time, sending the same event_id.
const processedEventIds = new Set<string>();
const MAX_EVENT_IDS = 5000;

function isDuplicateEvent(eventId: string): boolean {
  if (!eventId) return false;
  if (processedEventIds.has(eventId)) return true; // already seen = duplicate
  processedEventIds.add(eventId);
  if (processedEventIds.size > MAX_EVENT_IDS) {
    const arr = Array.from(processedEventIds);
    processedEventIds.clear();
    arr.slice(-MAX_EVENT_IDS / 2).forEach((id) => processedEventIds.add(id));
  }
  return false; // first time seeing this event
}

export async function handleSlackEvent(input: { payload: any }): Promise<void> {
  const eventId = input.payload?.event_id;
  if (eventId && isDuplicateEvent(eventId)) return; // duplicate – skip

  const teamId: string | undefined = input.payload?.team_id;
  const apiAppId: string | undefined = input.payload?.api_app_id;
  if (!teamId) return;
  if (!apiAppId) return;

  // url_verification is handled in the route before calling this.
  const event = input.payload?.event;
  if (!event) return;

  // Ignore bot messages (including ourselves).
  if (event.bot_id || event.subtype === "bot_message") return;

  const installation = await getSlackInstallationByTeamIdAndApiAppId({ teamId, apiAppId });
  if (!installation) return;

  if (event.type === "message" && event.channel_type === "im") {
    await handleDirectMessage({
      installation,
      channel: event.channel,
      user: event.user,
      text: event.text ?? "",
      ts: event.ts,
    });
    return;
  }

  if (event.type === "app_mention") {
    await handleAppMention({
      installation,
      channel: event.channel,
      user: event.user,
      text: event.text ?? "",
      ts: event.ts,
    });
    return;
  }
}

async function handleDirectMessage(input: {
  installation: SlackInstallationRow;
  channel: string;
  user: string;
  text: string;
  ts: string;
}) {
  const link = await getSlackAgentLinkByDmChannelId({
    teamId: input.installation.team_id,
    botKey: (input.installation as any).bot_key ?? "orchest",
    dmChannelId: input.channel,
  });
  if (!link) {
    await slackApi(input.installation.bot_access_token, "chat.postMessage", {
      channel: input.channel,
      text: "This workspace is connected, but no agent is enabled in Slack yet. Enable an agent from the Orchest dashboard first.",
    });
    return;
  }

  const taskText = normalizeSlackText(input.text);
  if (!taskText) return;

  const agent = await getAgentByIdScoped(input.installation.client_id, link.agent_id);
  if (!agent) return;

  const docLike = /\b(canvas|canvases|doc|docs|prd|spec|one-?pager|write-?up|notes|confluence|notion|google doc)\b/i.test(
    taskText
  );

  if (docLike) {
    console.log("[slack] routing message to task flow (doc-like request)");
    await runTaskAndReply({
      installation: input.installation,
      agentLink: link,
      channel: input.channel,
      threadTs: input.ts,
      taskText,
      forceCanvas: /\b(canvas|canvases)\b/i.test(taskText),
      requestUserId: input.user,
    });
    return;
  }

  const conversational = await tryConversationalReply({
    agentName: agent.name,
    agentRole: agent.role,
    systemPrompt: agent.system_prompt,
    userMessage: taskText,
  });

  if (conversational.type === "chat") {
    console.log("[slack] routing message to conversational reply");
    await slackApi(input.installation.bot_access_token, "chat.postMessage", {
      channel: input.channel,
      thread_ts: input.ts,
      text: conversational.reply,
      username: link.display_name,
      icon_url: link.icon_url ?? undefined,
    });
    return;
  }

  console.log("[slack] routing message to task flow");
  await runTaskAndReply({
    installation: input.installation,
    agentLink: link,
    channel: input.channel,
    threadTs: input.ts,
    taskText,
    forceCanvas: /\b(canvas|canvases)\b/i.test(taskText),
    requestUserId: input.user,
  });
}

async function handleAppMention(input: {
  installation: SlackInstallationRow;
  channel: string;
  user: string;
  text: string;
  ts: string;
}) {
  const cleaned = normalizeSlackText(input.text);
  if (!cleaned) return;

  const botKey = (input.installation as any).bot_key ?? "orchest";
  const link = await getSlackAgentLinkByTeamAndBotKey({
    teamId: input.installation.team_id,
    botKey,
  });

  if (!link) {
    await slackApi(input.installation.bot_access_token, "chat.postMessage", {
      channel: input.channel,
      thread_ts: input.ts,
      text: "This bot is installed, but no agent is linked to it yet. Enable an agent from the Orchest dashboard first.",
    });
    return;
  }

  const agent = await getAgentByIdScoped(input.installation.client_id, link.agent_id);
  if (!agent) return;

  const docLike = /\b(canvas|canvases|doc|docs|prd|spec|one-?pager|write-?up|notes|confluence|notion|google doc)\b/i.test(
    cleaned
  );
  if (docLike) {
    console.log("[slack] routing mention to task flow (doc-like request)");
    await runTaskAndReply({
      installation: input.installation,
      agentLink: link,
      channel: input.channel,
      threadTs: input.ts,
      taskText: cleaned,
      forceCanvas: /\b(canvas|canvases)\b/i.test(cleaned),
      requestUserId: input.user,
    });
    return;
  }

  const conversational = await tryConversationalReply({
    agentName: agent.name,
    agentRole: agent.role,
    systemPrompt: agent.system_prompt,
    userMessage: cleaned,
  });

  if (conversational.type === "chat") {
    console.log("[slack] routing mention to conversational reply");
    await slackApi(input.installation.bot_access_token, "chat.postMessage", {
      channel: input.channel,
      thread_ts: input.ts,
      text: conversational.reply,
      username: link.display_name,
      icon_url: link.icon_url ?? undefined,
    });
    return;
  }

  console.log("[slack] routing mention to task flow");
  await runTaskAndReply({
    installation: input.installation,
    agentLink: link,
    channel: input.channel,
    threadTs: input.ts,
    taskText: cleaned,
    forceCanvas: /\b(canvas|canvases)\b/i.test(cleaned),
    requestUserId: input.user,
  });
}

function normalizeSlackText(text: string): string {
  return String(text ?? "")
    .replace(/<@[A-Z0-9]+>/g, "") // strip mention tokens
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchThreadContext(input: {
  token: string;
  channel: string;
  threadTs: string;
}): Promise<string> {
  try {
    const json = await slackApi(input.token, "conversations.replies", {
      channel: input.channel,
      ts: input.threadTs,
      limit: 12,
      inclusive: true,
    });

    const messages: any[] = Array.isArray(json?.messages) ? json.messages : [];
    let source = messages;

    // If there's no actual thread (just the triggering message), fall back to channel history so the
    // agent maintains context in channels where people don't use threads.
    if (messages.length <= 1) {
      try {
        const hist = await slackApi(input.token, "conversations.history", {
          channel: input.channel,
          latest: input.threadTs,
          inclusive: true,
          limit: 12,
        });
        const hm: any[] = Array.isArray(hist?.messages) ? hist.messages : [];
        if (hm.length > 1) source = hm.reverse(); // oldest → newest
      } catch {
        // ignore
      }
    }

    const lines = source
      .filter((m) => typeof m?.text === "string" && m.text.trim().length > 0)
      .slice(-10)
      .map((m) => {
        const who = m.bot_id || m.subtype === "bot_message" ? "assistant" : "user";
        const t = normalizeSlackText(String(m.text));
        return `${who}: ${t}`;
      });

    if (lines.length === 0) return "";
    return ["", "Thread context (most recent):", ...lines].join("\n");
  } catch {
    return "";
  }
}

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

function stripCanvasDisclaimers(markdown: string): string {
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

function slackMrkdwnFromMarkdown(text: string): string {
  let s = String(text ?? "");
  // Headings: "## Title" -> "*Title*"
  s = s
    .split("\n")
    .map((line) => {
      const m = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
      if (!m) return line;
      const title = (m[2] ?? "").trim();
      return title ? `*${title}*` : line;
    })
    .join("\n");

  // Bold: **text** -> *text*
  s = s.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Horizontal rules / separators.
  s = s.replace(/^\s*---\s*$/gm, "────────");

  return s.trim();
}

async function postSlackTextChunked(input: {
  token: string;
  channel: string;
  threadTs?: string;
  text: string;
  username?: string;
  iconUrl?: string;
}) {
  const maxLen = 3500;
  const raw = slackMrkdwnFromMarkdown(String(input.text ?? ""));
  const chunks: string[] = [];
  let remaining = raw;
  while (remaining.length > maxLen) {
    // Prefer splitting on paragraph boundaries.
    let idx = remaining.lastIndexOf("\n\n", maxLen);
    if (idx < 500) idx = remaining.lastIndexOf("\n", maxLen);
    if (idx < 500) idx = maxLen;
    chunks.push(remaining.slice(0, idx).trim());
    remaining = remaining.slice(idx).trim();
  }
  if (remaining.trim()) chunks.push(remaining.trim());

  for (const c of chunks) {
    await slackApi(input.token, "chat.postMessage", {
      channel: input.channel,
      thread_ts: input.threadTs,
      text: c,
      username: input.username,
      icon_url: input.iconUrl,
    });
  }
}

async function createSlackCanvasFromMarkdown(input: {
  token: string;
  title: string;
  markdown: string;
  channelId?: string;
  requestUserId?: string;
}): Promise<{ canvasId: string; url?: string }> {
  const maxMarkdown = 95_000;
  const markdown =
    input.markdown.length > maxMarkdown ? input.markdown.slice(0, maxMarkdown) + "\n\n[truncated]" : input.markdown;
  const doc = { type: "markdown", markdown };

  const tryFilesInfo = async (canvasId: string): Promise<{ canvasId: string; url?: string }> => {
    try {
      const info = await slackApi(input.token, "files.info", { file: canvasId });
      const url: string | undefined = info?.file?.permalink;
      return { canvasId, url };
    } catch (err) {
      console.error("[slack] files.info failed for canvas", err);
      return { canvasId };
    }
  };

  const tryBuildCanvasUrl = async (canvasId: string): Promise<string | undefined> => {
    // Fallback: construct a docs URL using the workspace URL from auth.test.
    // Slack canvas examples use: https://<workspace>.slack.com/docs/<TEAM_ID>/<CANVAS_ID>
    try {
      const auth = await slackApi(input.token, "auth.test", {});
      const baseUrl: string | undefined = auth?.url;
      const teamId: string | undefined = auth?.team_id;
      if (!baseUrl || !teamId) return undefined;
      return `${String(baseUrl).replace(/\/+$/, "")}/docs/${teamId}/${canvasId}`;
    } catch (err) {
      console.error("[slack] auth.test failed while building canvas url", err);
      return undefined;
    }
  };

  const isChannel = Boolean(input.channelId && /^[CG]/.test(input.channelId));

  // Prefer a conversation canvas for channels (more reliable permissions model than standalone canvases for apps).
  if (input.channelId && isChannel) {
    try {
      const created = await slackApi(input.token, "conversations.canvases.create", {
        channel_id: input.channelId,
        title: input.title,
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

  console.log("[slack] attempting standalone canvas create", {
    titleLen: input.title.length,
    markdownLen: doc.markdown.length,
    channelIdPrefix: input.channelId?.slice(0, 1) ?? null,
  });
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

async function runTaskAndReply(input: {
  installation: SlackInstallationRow;
  agentLink: SlackAgentLinkRow;
  channel: string;
  threadTs: string;
  taskText: string;
  forceCanvas?: boolean;
  requestUserId?: string;
}) {
  const agent = await getAgentByIdScoped(input.installation.client_id, input.agentLink.agent_id);
  if (!agent) return;

  const profileMemories = await listAgentMemoriesByTypeScoped({
    clientId: input.installation.client_id,
    agentId: agent.id,
    memoryType: "profile",
    limit: 10,
  }).catch(() => []);

  const threadContext = await fetchThreadContext({
    token: input.installation.bot_access_token,
    channel: input.channel,
    threadTs: input.threadTs,
  });

  const task = await createTaskForAgentScoped({
    clientId: input.installation.client_id,
    agentId: agent.id,
    taskInput: `${input.taskText}${threadContext}`,
  });

  let postedProgressHeader = false;
  const postProgress = async (text: string) => {
    if (!text) return;
    if (!postedProgressHeader) {
      postedProgressHeader = true;
      await slackApi(input.installation.bot_access_token, "chat.postMessage", {
        channel: input.channel,
        thread_ts: input.threadTs,
        text: "I’ll share quick progress notes in this thread as I work.",
        username: input.agentLink.display_name,
        icon_url: input.agentLink.icon_url ?? undefined,
      });
    }
    const italic = "_" + String(text).replace(/_/g, "\\_").trim() + "_";
    await slackApi(input.installation.bot_access_token, "chat.postMessage", {
      channel: input.channel,
      thread_ts: input.threadTs,
      text: italic,
      username: input.agentLink.display_name,
      icon_url: input.agentLink.icon_url ?? undefined,
    });
  };

  const formatPlanForUser = async (plan: { steps: string[]; notes?: string }): Promise<string> => {
    const ack = await generateSlackPlanAck({
      agentName: agent.name,
      agentRole: agent.role,
      systemPrompt: agent.system_prompt,
      taskText: input.taskText,
      plan,
      profileMemories: profileMemories.map((m) => m.content),
    }).catch(() => null);
    if (ack) return ack;

    // Fallback only if LLM call fails.
    if (plan.steps.length === 0) return "On it.";
    const steps = plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
    return `On it.\n\nPlan:\n${steps}`;
  };

  void runAgentTask(task.id, {
    onPlanReady: async (plan) => {
      await postSlackTextChunked({
        token: input.installation.bot_access_token,
        channel: input.channel,
        threadTs: input.threadTs,
        text: await formatPlanForUser(plan),
        username: input.agentLink.display_name,
        iconUrl: input.agentLink.icon_url ?? undefined,
      });
    },
    onProgress: async (u) => {
      if (!u.text) return;
      await postProgress(u.text);
    },
  })
    .then(async (result) => {
      const wantsCanvas =
        Boolean(input.forceCanvas) || /\b(canvas|canvases)\b/i.test(input.taskText) || /\bslack canvas\b/i.test(input.taskText);
      const isLong = result.summary.length > 2500 || result.summary.split("\n").length > 60;

      if (wantsCanvas || isLong) {
        try {
          const title = deriveCanvasTitle({ taskText: input.taskText, agentName: agent.name });
          const canvasMarkdown = stripCanvasDisclaimers(result.summary);
          const canvas = await createSlackCanvasFromMarkdown({
            token: input.installation.bot_access_token,
            title,
            markdown: canvasMarkdown,
            channelId: input.channel,
            requestUserId: input.requestUserId,
          });

          if (canvas.canvasId && canvas.url) {
            // Share link in-thread first (Slack doc: required before canvases.access.set with user_ids).
            await slackApi(input.installation.bot_access_token, "chat.postMessage", {
              channel: input.channel,
              thread_ts: input.threadTs,
              text: `I put this in a Canvas: <${canvas.url}|open canvas>.`,
              username: input.agentLink.display_name,
              icon_url: input.agentLink.icon_url ?? undefined,
            });

            // If this was a DM/MPDM, explicitly grant the requesting user access.
            // Note: Slack requires user_ids (not channel_ids) for D/MPDM.
            if (input.requestUserId && /^D/.test(input.channel)) {
              try {
                await slackApi(input.installation.bot_access_token, "canvases.access.set", {
                  canvas_id: canvas.canvasId,
                  user_ids: [input.requestUserId],
                  access_level: "write",
                });
                console.log("[slack] granted user access to canvas", { canvasId: canvas.canvasId });
              } catch (err) {
                console.error("[slack] canvases.access.set failed", err);
              }
            }

            const preview = result.summary.split("\n").slice(0, 12).join("\n") + "\n\n…";
            await postSlackTextChunked({
              token: input.installation.bot_access_token,
              channel: input.channel,
              threadTs: input.threadTs,
              text: stripCanvasDisclaimers(preview),
              username: input.agentLink.display_name,
              iconUrl: input.agentLink.icon_url ?? undefined,
            });
            return;
          }

          if (canvas.canvasId && !canvas.url) {
            console.warn("[slack] canvas created but no url (files.info + fallback failed)", {
              canvasId: canvas.canvasId,
            });
            await slackApi(input.installation.bot_access_token, "chat.postMessage", {
              channel: input.channel,
              thread_ts: input.threadTs,
              text:
                "I created a Canvas, but Slack didn’t give me a permalink to share. " +
                `Canvas id: ${canvas.canvasId}. This often means the token is missing \`files:read\` scope or your workspace plan restricts Canvas APIs.`,
              username: input.agentLink.display_name,
              icon_url: input.agentLink.icon_url ?? undefined,
            });
          }
        } catch (err) {
          console.error("[slack] canvases.create failed; falling back to thread", err);
        }
      }

      await postSlackTextChunked({
        token: input.installation.bot_access_token,
        channel: input.channel,
        threadTs: input.threadTs,
        text: result.summary,
        username: input.agentLink.display_name,
        iconUrl: input.agentLink.icon_url ?? undefined,
      });
    })
    .catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      await slackApi(input.installation.bot_access_token, "chat.postMessage", {
        channel: input.channel,
        thread_ts: input.threadTs,
        text: `I hit an error while running that: ${msg}`,
        username: input.agentLink.display_name,
        icon_url: input.agentLink.icon_url ?? undefined,
      });
    });
}

