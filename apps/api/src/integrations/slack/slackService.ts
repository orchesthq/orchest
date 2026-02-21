import crypto from "crypto";
import {
  consumeSlackOauthState,
  createSlackOauthState,
  getAgentByIdScoped,
  getSlackAgentLinkByDmChannelId,
  getSlackAgentLinkByTeamAndBotKey,
  getSlackInstallationByClientIdAndBotKey,
  getSlackInstallationByTeamIdAndApiAppId,
  upsertSlackAgentLink,
  upsertSlackInstallation,
  type SlackAgentLinkRow,
  type SlackInstallationRow,
} from "../../db/schema";
import { createTaskForAgentScoped } from "../../db/schema";
import { runAgentTask } from "../../agent/agentLoop";
import { tryConversationalReply } from "../../services/openaiService";

export class SlackConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlackConfigError";
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new SlackConfigError(`${name} is not configured`);
  return v;
}

function botKeyToPrefix(botKey: string): string {
  return `SLACK_${botKey.toUpperCase()}`;
}

function getSlackBotClientId(botKey: string): string {
  return requireEnv(`${botKeyToPrefix(botKey)}_CLIENT_ID`);
}

function getSlackBotClientSecret(botKey: string): string {
  return requireEnv(`${botKeyToPrefix(botKey)}_CLIENT_SECRET`);
}

function getSlackBotSigningSecret(botKey: string): string {
  return requireEnv(`${botKeyToPrefix(botKey)}_SIGNING_SECRET`);
}

export function listSlackBotKeys(): string[] {
  const raw = requireEnv("SLACK_BOT_KEYS");
  const keys = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (keys.length === 0) throw new SlackConfigError("SLACK_BOT_KEYS is empty");
  return keys;
}

export function listSlackSigningSecrets(): string[] {
  return listSlackBotKeys().map(getSlackBotSigningSecret);
}

export function getSlackAuthorizeUrl(input: { botKey: string; state: string }): string {
  const clientId = getSlackBotClientId(input.botKey);
  const redirectUri = requireEnv("SLACK_REDIRECT_URI");

  // Bot scopes needed for: events + messaging + persona customization.
  const scopes = [
    "chat:write",
    "chat:write.customize",
    "im:write",
    "channels:read",
    "groups:read",
    "im:read",
    "mpim:read",
    "app_mentions:read",
  ].join(",");

  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
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

  const clientIdEnv = getSlackBotClientId(botKey);
  const clientSecret = getSlackBotClientSecret(botKey);
  const redirectUri = requireEnv("SLACK_REDIRECT_URI");

  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientIdEnv,
      client_secret: clientSecret,
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

async function slackApi(token: string, method: string, payload: Record<string, any>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as any;
  if (!json?.ok) {
    throw new Error(`Slack API ${method} failed: ${json?.error ?? "unknown_error"}`);
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

  const conversational = await tryConversationalReply({
    agentName: agent.name,
    agentRole: agent.role,
    systemPrompt: agent.system_prompt,
    userMessage: taskText,
  });

  if (conversational.type === "chat") {
    await slackApi(input.installation.bot_access_token, "chat.postMessage", {
      channel: input.channel,
      thread_ts: input.ts,
      text: conversational.reply,
      username: link.display_name,
      icon_url: link.icon_url ?? undefined,
    });
    return;
  }

  await runTaskAndReply({
    installation: input.installation,
    agentLink: link,
    channel: input.channel,
    threadTs: input.ts,
    taskText,
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

  const conversational = await tryConversationalReply({
    agentName: agent.name,
    agentRole: agent.role,
    systemPrompt: agent.system_prompt,
    userMessage: cleaned,
  });

  if (conversational.type === "chat") {
    await slackApi(input.installation.bot_access_token, "chat.postMessage", {
      channel: input.channel,
      thread_ts: input.ts,
      text: conversational.reply,
      username: link.display_name,
      icon_url: link.icon_url ?? undefined,
    });
    return;
  }

  await runTaskAndReply({
    installation: input.installation,
    agentLink: link,
    channel: input.channel,
    threadTs: input.ts,
    taskText: cleaned,
  });
}

function normalizeSlackText(text: string): string {
  return String(text ?? "")
    .replace(/<@[A-Z0-9]+>/g, "") // strip mention tokens
    .replace(/\s+/g, " ")
    .trim();
}

async function runTaskAndReply(input: {
  installation: SlackInstallationRow;
  agentLink: SlackAgentLinkRow;
  channel: string;
  threadTs: string;
  taskText: string;
}) {
  const agent = await getAgentByIdScoped(input.installation.client_id, input.agentLink.agent_id);
  if (!agent) return;

  const task = await createTaskForAgentScoped({
    clientId: input.installation.client_id,
    agentId: agent.id,
    taskInput: input.taskText,
  });

  const formatPlanForUser = (plan: { steps: string[]; notes?: string }): string => {
    if (plan.steps.length === 0) return "Got it — I'm on it.";
    const steps = plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
    return `Got it — I'm on it.\n\nI'll:\n${steps}`;
  };

  void runAgentTask(task.id, {
    onPlanReady: async (plan) => {
      await slackApi(input.installation.bot_access_token, "chat.postMessage", {
        channel: input.channel,
        thread_ts: input.threadTs,
        text: formatPlanForUser(plan),
        username: input.agentLink.display_name,
        icon_url: input.agentLink.icon_url ?? undefined,
      });
    },
  })
    .then(async (result) => {
      await slackApi(input.installation.bot_access_token, "chat.postMessage", {
        channel: input.channel,
        thread_ts: input.threadTs,
        text: result.summary,
        username: input.agentLink.display_name,
        icon_url: input.agentLink.icon_url ?? undefined,
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

