import crypto from "crypto";
import {
  consumeSlackOauthState,
  createSlackOauthState,
  getAgentByIdScoped,
  getSlackAgentLinkByDmChannelId,
  getSlackInstallationByClientId,
  getSlackInstallationByTeamId,
  listAgentsScoped,
  upsertSlackAgentLink,
  upsertSlackInstallation,
  type SlackAgentLinkRow,
  type SlackInstallationRow,
} from "../../db/schema";
import { createTaskForAgentScoped } from "../../db/schema";
import { runAgentTask } from "../../agent/agentLoop";

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

export function getSlackAuthorizeUrl(input: { state: string }): string {
  const clientId = requireEnv("SLACK_CLIENT_ID");
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

export async function createSlackInstallState(clientId: string): Promise<string> {
  const state = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await createSlackOauthState({ clientId, state, expiresAt });
  return state;
}

export async function handleSlackOAuthCallback(input: {
  code: string;
  state: string;
}): Promise<SlackInstallationRow> {
  const record = await consumeSlackOauthState(input.state);
  if (!record) throw new Error("Invalid or expired Slack OAuth state");

  const clientId = record.client_id;

  const clientIdEnv = requireEnv("SLACK_CLIENT_ID");
  const clientSecret = requireEnv("SLACK_CLIENT_SECRET");
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

  return await upsertSlackInstallation({
    clientId,
    teamId,
    teamName: teamName ?? null,
    enterpriseId: enterpriseId ?? null,
    botUserId,
    botAccessToken,
    installedByUserId,
  });
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
  iconUrl?: string | null;
}): Promise<SlackAgentLinkRow> {
  const installation = await getSlackInstallationByClientId(input.clientId);
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

export async function handleSlackEvent(input: { payload: any }): Promise<void> {
  const teamId: string | undefined = input.payload?.team_id;
  if (!teamId) return;

  // url_verification is handled in the route before calling this.
  const event = input.payload?.event;
  if (!event) return;

  // Ignore bot messages (including ourselves).
  if (event.bot_id || event.subtype === "bot_message") return;

  const installation = await getSlackInstallationByTeamId(teamId);
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

  const { agentNameHint, taskText } = extractAgentHint(cleaned);
  const agent = await chooseAgentForMention({
    clientId: input.installation.client_id,
    agentNameHint,
  });
  if (!agent) {
    await slackApi(input.installation.bot_access_token, "chat.postMessage", {
      channel: input.channel,
      thread_ts: input.ts,
      text: "No agents found for this client. Create one in Orchest first.",
    });
    return;
  }

  const link = await upsertSlackAgentLink({
    clientId: input.installation.client_id,
    agentId: agent.id,
    teamId: input.installation.team_id,
    displayName: agent.name,
    iconUrl: null,
  });

  await runTaskAndReply({
    installation: input.installation,
    agentLink: link,
    channel: input.channel,
    threadTs: input.ts,
    taskText: taskText ?? cleaned,
  });
}

async function chooseAgentForMention(input: {
  clientId: string;
  agentNameHint: string | null;
}) {
  const agents = await listAgentsScoped(input.clientId);
  if (agents.length === 0) return null;
  if (!input.agentNameHint) return agents[0];

  const hint = input.agentNameHint.toLowerCase();
  return (
    agents.find((a) => a.name.toLowerCase() === hint) ??
    agents.find((a) => a.name.toLowerCase().startsWith(hint)) ??
    agents[0]
  );
}

function extractAgentHint(text: string): { agentNameHint: string | null; taskText: string | null } {
  // Supports patterns:
  // - "Ava: do X"
  // - "Ava do X"
  const m = text.match(/^([A-Za-z0-9_-]{2,32})\s*:\s*(.+)$/);
  if (m) return { agentNameHint: m[1] ?? null, taskText: m[2] ?? null };

  const parts = text.split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    // Heuristic: treat first token as agent name if it looks like a name.
    return { agentNameHint: parts[0], taskText: parts.slice(1).join(" ") };
  }

  return { agentNameHint: null, taskText: null };
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

  // Ack quickly.
  await slackApi(input.installation.bot_access_token, "chat.postMessage", {
    channel: input.channel,
    thread_ts: input.threadTs,
    text: "Got it — I’m on it.",
    username: input.agentLink.display_name,
    icon_url: input.agentLink.icon_url ?? undefined,
  });

  const task = await createTaskForAgentScoped({
    clientId: input.installation.client_id,
    agentId: agent.id,
    taskInput: input.taskText,
  });

  void runAgentTask(task.id)
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

