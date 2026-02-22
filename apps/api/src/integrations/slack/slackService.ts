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
    "conversation_id",
    "thread_ts",
    "ts",
    "user",
    "team_id",
    "canvas_id",
    "title",
    "document",
    "blocks",
    "context",
  ];

  const out: Record<string, any> = {};
  for (const k of allow) {
    if (!(k in payload)) continue;
    const v = payload[k];
    if (k === "blocks" && Array.isArray(v)) out[k] = { count: v.length };
    else if (k === "document" && v && typeof v === "object") out[k] = { keys: Object.keys(v).slice(0, 20) };
    else if (typeof v === "string" && v.length > 200) out[k] = v.slice(0, 200) + "…";
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

  let json: any;
  try {
    json = await res.json();
  } catch (err) {
    console.error("[slack] non-json response", {
      method,
      status: res.status,
      statusText: res.statusText,
      payload: redactSlackPayload(payload),
    });
    throw err;
  }

  if (!json?.ok) {
    console.error("[slack] api error", {
      method,
      status: res.status,
      statusText: res.statusText,
      error: json?.error,
      response_metadata: json?.response_metadata,
      payload: redactSlackPayload(payload),
    });
    throw new Error(`Slack API ${method} failed: ${json?.error ?? "unknown_error"}`);
  }

  return json;
}

// (rest of file unchanged)
