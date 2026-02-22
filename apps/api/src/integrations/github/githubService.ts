import crypto from "crypto";
import { z } from "zod";
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
import { isDbConfigured } from "../../db/client";
import { getPartnerSetting } from "../../db/schema";

export class GitHubConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubConfigError";
  }
}

const githubPartnerSettingsSchema = z
  .object({
    appId: z.union([z.number().int().positive(), z.string().min(1)]),
    privateKey: z.string().min(1),
    appSlug: z.string().min(1),
  })
  .passthrough();

type GitHubAppConfig = {
  appId: number;
  privateKey: string;
  appSlug: string;
};

const GITHUB_SETTINGS_CACHE_TTL_MS = 30_000;
let githubAppConfigCache:
  | {
      loadedAtMs: number;
      config: GitHubAppConfig | null;
    }
  | undefined;

function parseAppId(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizePrivateKey(raw: string): string {
  let s = String(raw ?? "").trim();

  // Common when pasting into SQL/JSON tooling: extra wrapping quotes.
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s.slice(1, -1);
  }

  // Normalize Windows newlines and common escape patterns.
  // - actual newlines: \r\n -> \n
  // - escaped: "\\n" or "\n" or "\\r\\n"
  s = s
    .replace(/\r\n/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();

  // If someone stored the PEM as a single line, re-wrap the base64 body.
  const m = s.match(
    /(-----BEGIN [^-]+-----)([\s\S]*?)(-----END [^-]+-----)/m
  );
  if (m) {
    const header = m[1].trim();
    const footer = m[3].trim();
    const body = String(m[2] ?? "")
      .replace(/[\r\n\s]+/g, "")
      .trim();
    if (body.length > 0) {
      const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
      s = `${header}\n${wrapped}\n${footer}\n`;
    }
  }

  return s.trim();
}

function validatePrivateKeyOrThrow(privateKey: string): void {
  try {
    // If this throws, JWT signing will fail later anyway; surface early.
    crypto.createPrivateKey({ key: privateKey, format: "pem" });
  } catch {
    throw new GitHubConfigError(
      "GitHub App private key is invalid. Store the PEM in partner_settings(github/default).settings.privateKey using real newlines (recommended: SQL $$...$$), or store it with literal \\n sequences (not double-escaped)."
    );
  }
}

async function getGitHubAppConfigFromDb(): Promise<GitHubAppConfig | null> {
  const row = await getPartnerSetting({ partner: "github", key: "default" });
  if (!row) return null;
  const parsed = githubPartnerSettingsSchema.safeParse(row.settings ?? null);
  if (!parsed.success) return null;
  const appId = parseAppId(parsed.data.appId);
  if (!appId) return null;
  return {
    appId,
    privateKey: normalizePrivateKey(parsed.data.privateKey),
    appSlug: parsed.data.appSlug,
  };
}

async function getGitHubAppConfigOrNull(): Promise<GitHubAppConfig | null> {
  const now = Date.now();
  if (githubAppConfigCache && now - githubAppConfigCache.loadedAtMs < GITHUB_SETTINGS_CACHE_TTL_MS) {
    return githubAppConfigCache.config;
  }

  let config: GitHubAppConfig | null = null;
  if (isDbConfigured()) {
    try {
      config = await getGitHubAppConfigFromDb();
    } catch (err) {
      console.error("[github] failed to load app settings from DB", err);
    }
  }

  githubAppConfigCache = { loadedAtMs: now, config };
  return config;
}

async function requireGitHubAppConfig(): Promise<GitHubAppConfig> {
  const cfg = await getGitHubAppConfigOrNull();
  if (!cfg) {
    throw new GitHubConfigError(
      "GitHub integration is not configured. Configure partner_settings(github/default)."
    );
  }
  validatePrivateKeyOrThrow(cfg.privateKey);
  return cfg;
}

/**
 * Create a JWT for authenticating as the GitHub App (RS256).
 * https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 */
async function createAppJwt(): Promise<string> {
  const { appId, privateKey } = await requireGitHubAppConfig();
  const keyObject = crypto.createPrivateKey({ key: privateKey, format: "pem" });
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
  const sig = crypto.createSign("RSA-SHA256").update(signatureInput).sign(keyObject, "base64url");
  return `${signatureInput}.${sig}`;
}

/**
 * Exchange installation_id for an access token.
 */
export async function getInstallationAccessToken(installationId: number): Promise<{
  token: string;
  expiresAt: Date | null;
}> {
  const jwt = await createAppJwt();
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
export async function getGitHubInstallUrl(): Promise<string> {
  const { appSlug } = await requireGitHubAppConfig();
  const slug = appSlug;
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

  const jwt = await createAppJwt();
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

async function isGitHubConfigured(): Promise<boolean> {
  const cfg = await getGitHubAppConfigOrNull();
  return Boolean(cfg?.appId && cfg?.privateKey && cfg?.appSlug);
}

export async function getGitHubStatus(clientId: string): Promise<{
  connected: boolean;
  configured: boolean;
  ownerLogin?: string;
  installationId?: number;
}> {
  if (!(await isGitHubConfigured())) {
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
