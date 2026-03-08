import crypto from "crypto";
import { z } from "zod";
import {
  consumeSlackOauthState,
  createSlackOauthState,
  getAgentByIdScoped,
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
import { isDbConfigured } from "../../db/client";
import { slackApi } from "./slackApiClient";
import { createSlackTransport } from "./slackTransport";
import { handleInboundChatMessage } from "../../chat/agentChatOrchestrator";
import { getThreadSubscription, subscribeThread } from "../../chat/threadSubscriptions";

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

  const botKey = (installation as any).bot_key ?? "orchest";
  const accountId = `${installation.team_id}:${botKey}`;
  const transport = createSlackTransport({ token: installation.bot_access_token });

  if (event.type === "message" && event.channel_type === "im") {
    const dmThreadTs = typeof event.thread_ts === "string" && event.thread_ts ? event.thread_ts : event.ts;
    const link = await getSlackAgentLinkByDmChannelId({
      teamId: installation.team_id,
      botKey,
      dmChannelId: event.channel,
    });
    if (!link) {
      await transport.postMessage({
        conversationId: event.channel,
        threadId: event.ts,
        text: "This workspace is connected, but no agent is enabled in Slack yet. Enable an agent from the Orchest dashboard first.",
      });
      return;
    }

    const taskText = normalizeSlackText(event.text ?? "");
    if (!taskText) return;

    await handleInboundChatMessage({
      msg: {
        surface: "slack",
        accountId,
        conversationId: event.channel,
        threadId: dmThreadTs,
        senderId: event.user,
        text: taskText,
        ts: event.ts,
        clientId: installation.client_id,
        agentId: link.agent_id,
        kind: "dm",
        addressedToAgent: true,
        context: {
          displayName: link.display_name,
          iconUrl: link.icon_url ?? null,
          slack_request_user_id: event.user,
          slack_channel_id: event.channel,
          slack_thread_ts: dmThreadTs,
        },
      },
      transport,
      author: { displayName: link.display_name, iconUrl: link.icon_url ?? null },
    });
    return;
  }

  // Follow-up thread replies in channels/groups: handle only if we were previously @mentioned in the thread.
  if (
    event.type === "message" &&
    (event.channel_type === "channel" || event.channel_type === "group") &&
    typeof event.thread_ts === "string" &&
    event.thread_ts &&
    !event.subtype
  ) {
    const sub = getThreadSubscription({
      surface: "slack",
      accountId,
      conversationId: event.channel,
      threadId: event.thread_ts,
    });
    if (!sub) return;

    const taskText = normalizeSlackText(event.text ?? "");
    if (!taskText) return;

    // "Clear that this is for them" heuristic: questions / explicit ask / name.
    const agent = await getAgentByIdScoped(installation.client_id, sub.agentId);
    if (!agent) return;
    const name = agent.name.toLowerCase();
    const lower = taskText.toLowerCase();
    const addressed =
      lower.startsWith(name) ||
      lower.includes(` ${name} `) ||
      /\?$/.test(taskText.trim()) ||
      /^\s*(can you|could you|please|any chance|would you)\b/i.test(taskText);
    if (!addressed) return;

    const link = await getSlackAgentLinkByTeamAndBotKey({
      teamId: installation.team_id,
      botKey,
    });
    if (!link || link.agent_id !== sub.agentId) return;

    await handleInboundChatMessage({
      msg: {
        surface: "slack",
        accountId,
        conversationId: event.channel,
        threadId: event.thread_ts,
        senderId: event.user,
        text: taskText,
        ts: event.ts,
        clientId: installation.client_id,
        agentId: link.agent_id,
        kind: "thread_reply",
        addressedToAgent: true,
        context: {
          displayName: link.display_name,
          iconUrl: link.icon_url ?? null,
          slack_request_user_id: event.user,
          slack_channel_id: event.channel,
        },
      },
      transport,
      author: { displayName: link.display_name, iconUrl: link.icon_url ?? null },
    });
    return;
  }

  if (event.type === "app_mention") {
    const cleaned = normalizeSlackText(event.text ?? "");
    if (!cleaned) return;

    const link = await getSlackAgentLinkByTeamAndBotKey({
      teamId: installation.team_id,
      botKey,
    });
    if (!link) {
      await transport.postMessage({
        conversationId: event.channel,
        threadId: event.ts,
        text: "This bot is installed, but no agent is linked to it yet. Enable an agent from the Orchest dashboard first.",
      });
      return;
    }

    // Mark this thread as "subscribed" for follow-up replies without needing another @mention.
    const actualThreadTs = event.thread_ts ?? event.ts;
    subscribeThread({
      surface: "slack",
      accountId,
      conversationId: event.channel,
      threadId: actualThreadTs,
      clientId: installation.client_id,
      agentId: link.agent_id,
    });

    const replyThreadTs = event.thread_ts ?? event.ts;
    await handleInboundChatMessage({
      msg: {
        surface: "slack",
        accountId,
        conversationId: event.channel,
        threadId: replyThreadTs,
        senderId: event.user,
        text: cleaned,
        ts: event.ts,
        clientId: installation.client_id,
        agentId: link.agent_id,
        kind: "mention",
        addressedToAgent: true,
        context: {
          displayName: link.display_name,
          iconUrl: link.icon_url ?? null,
          slack_request_user_id: event.user,
          slack_channel_id: event.channel,
        },
      },
      transport,
      author: { displayName: link.display_name, iconUrl: link.icon_url ?? null },
    });
    return;
  }
}

function normalizeSlackText(text: string): string {
  return String(text ?? "")
    .replace(/<@[A-Z0-9]+>/g, "") // strip mention tokens
    .replace(/\s+/g, " ")
    .trim();
}

