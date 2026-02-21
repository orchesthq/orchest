import crypto from "crypto";
import {
  createGitHubAgentConnection,
  getGitHubAgentConnectionByAgentId,
  getGitHubInstallationByClientId,
  getGitHubInstallationById,
  upsertGitHubInstallation,
  type GitHubAgentConnectionRow,
  type GitHubInstallationRow,
} from "../../db/schema";
import { getAgentByIdScoped } from "../../db/schema";

export class GitHubConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubConfigError";
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new GitHubConfigError(`${name} is not configured`);
  return v;
}

function getAppId(): number {
  const v = requireEnv("GITHUB_APP_ID");
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) throw new GitHubConfigError("GITHUB_APP_ID must be a number");
  return n;
}

function getPrivateKey(): string {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!raw) throw new GitHubConfigError("GITHUB_APP_PRIVATE_KEY is not configured");
  return raw.replace(/\\n/g, "\n");
}

function getAppSlug(): string {
  return requireEnv("GITHUB_APP_SLUG");
}

/**
 * Create a JWT for authenticating as the GitHub App (RS256).
 * https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 */
function createAppJwt(): string {
  const appId = getAppId();
  const privateKey = getPrivateKey();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 600,
    iss: appId,
  };
  const header = { alg: "RS256", typ: "JWT" };
  const base64 = (b: Buffer) => b.toString("base64url");
  const payloadB64 = base64(Buffer.from(JSON.stringify(payload)));
  const headerB64 = base64(Buffer.from(JSON.stringify(header)));
  const signatureInput = `${headerB64}.${payloadB64}`;
  const sig = crypto.createSign("RSA-SHA256").update(signatureInput).sign(privateKey, "base64url");
  return `${signatureInput}.${sig}`;
}

/**
 * Exchange installation_id for an access token.
 */
export async function getInstallationAccessToken(installationId: number): Promise<{
  token: string;
  expiresAt: Date | null;
}> {
  const jwt = createAppJwt();
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub installation token failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { token: string; expires_at: string };
  return {
    token: json.token,
    expiresAt: json.expires_at ? new Date(json.expires_at) : null,
  };
}

/**
 * Install URL: user is sent here to install the Orchest GitHub App.
 * Append state with clientId so we can associate the install.
 */
export function getGitHubInstallUrl(): string {
  const slug = getAppSlug();
  return `https://github.com/apps/${slug}/installations/new`;
}

/**
 * After user installs, GitHub redirects to our Setup URL with installation_id.
 * We exchange for a token and store. ClientId comes from cookie set before redirect.
 */
export async function handleGitHubInstallationCallback(input: {
  installationId: number;
  clientId: string;
}): Promise<GitHubInstallationRow> {
  const { token, expiresAt } = await getInstallationAccessToken(input.installationId);

  const jwt = createAppJwt();
  const res = await fetch("https://api.github.com/app/installations/" + input.installationId, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub installation details failed: ${res.status} ${text}`);
  }
  const inst = (await res.json()) as { account: { login: string } };
  const ownerLogin = inst.account?.login ?? "unknown";

  return upsertGitHubInstallation({
    clientId: input.clientId,
    installationId: input.installationId,
    ownerLogin,
    accessToken: token,
    tokenExpiresAt: expiresAt,
  });
}

function isGitHubConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_APP_PRIVATE_KEY &&
    process.env.GITHUB_APP_SLUG
  );
}

export async function getGitHubStatus(clientId: string): Promise<{
  connected: boolean;
  configured: boolean;
  ownerLogin?: string;
  installationId?: number;
}> {
  if (!isGitHubConfigured()) {
    return { connected: false, configured: false };
  }
  const inst = await getGitHubInstallationByClientId(clientId);
  if (!inst) return { connected: false, configured: true };
  return {
    connected: true,
    configured: true,
    ownerLogin: inst.owner_login,
    installationId: inst.installation_id,
  };
}

export async function linkAgentToGitHub(input: {
  clientId: string;
  agentId: string;
  commitAuthorName: string;
  commitAuthorEmail: string;
  accessLevel?: "read" | "pr_only" | "direct_push";
  defaultBranch?: string;
  defaultRepo?: string | null;
}): Promise<GitHubAgentConnectionRow> {
  const installation = await getGitHubInstallationByClientId(input.clientId);
  if (!installation) {
    throw new Error("GitHub is not connected for this client. Connect GitHub first.");
  }

  const agent = await getAgentByIdScoped(input.clientId, input.agentId);
  if (!agent) throw new Error("Agent not found");

  const safeEmail = (s: string) => s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  if (!input.defaultRepo?.trim()) {
    throw new Error("Repository is required. Select a repository when linking the agent.");
  }

  return createGitHubAgentConnection({
    agentId: input.agentId,
    githubInstallationId: installation.id,
    commitAuthorName: input.commitAuthorName?.trim() || agent.name,
    commitAuthorEmail: input.commitAuthorEmail?.trim() || `${safeEmail(agent.name)}@agents.orchest.io`,
    accessLevel: input.accessLevel ?? "pr_only",
    defaultBranch: input.defaultBranch ?? "main",
    defaultRepo: input.defaultRepo.trim(),
  });
}

/**
 * List repositories the installation has access to.
 */
export async function listInstallationRepos(clientId: string): Promise<Array<{ full_name: string }>> {
  const installation = await getGitHubInstallationByClientId(clientId);
  if (!installation) return [];

  const token = await getValidInstallationToken(installation.installation_id);
  const res = await fetch("https://api.github.com/installation/repositories", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { repositories?: Array<{ full_name: string }> };
  return json.repositories?.map((r) => ({ full_name: r.full_name })) ?? [];
}

export async function getAgentGitHubConnection(
  clientId: string,
  agentId: string
): Promise<GitHubAgentConnectionRow | null> {
  const agent = await getAgentByIdScoped(clientId, agentId);
  if (!agent) return null;
  return getGitHubAgentConnectionByAgentId(agentId);
}

/**
 * Get a valid token for an installation. Fetches fresh token (they expire in 1h).
 */
export async function getValidInstallationToken(installationId: number): Promise<string> {
  const { token } = await getInstallationAccessToken(installationId);
  return token;
}
