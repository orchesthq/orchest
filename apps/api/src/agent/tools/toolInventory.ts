import { getSlackAgentLinkByAgentId, listKbSourcesByClientId, getPartnerSetting } from "../../db/schema";
import { listAgentGitHubConnections } from "../../integrations/github/githubService";

export type ToolId = "github" | "slack" | "kb";

export type GitHubAccessLevel = "read" | "pr_only" | "direct_push";

export type GitHubToolAccess = {
  available: boolean;
  // Highest access across connections (useful for capability gating).
  maxAccessLevel: GitHubAccessLevel | null;
  // Repo selectors this agent has access to (full_name or "*").
  repoSelectors: string[];
  // Raw connections (for more detailed future policies).
  connections: Array<{ default_repo: string; access_level: GitHubAccessLevel }>;
};

export type SlackToolAccess = {
  available: boolean;
  teamId: string | null;
  botKey: string | null;
  dmChannelId: string | null;
  displayName: string | null;
};

export type KbToolAccess = {
  available: boolean;
  sourcesCount: number;
  embeddingsConfigured: boolean;
};

export type ToolAccessSummary = {
  github: GitHubToolAccess;
  slack: SlackToolAccess;
  kb: KbToolAccess;
};

function rankGitHubAccess(level: GitHubAccessLevel): number {
  if (level === "direct_push") return 3;
  if (level === "pr_only") return 2;
  return 1;
}

function maxGitHubAccessLevel(levels: GitHubAccessLevel[]): GitHubAccessLevel | null {
  if (levels.length === 0) return null;
  return levels.reduce((best, cur) => (rankGitHubAccess(cur) > rankGitHubAccess(best) ? cur : best));
}

export async function getToolAccessSummary(input: {
  clientId: string;
  agentId: string;
}): Promise<ToolAccessSummary> {
  const [slackLink, ghConnections, kbSources, openai] = await Promise.all([
    getSlackAgentLinkByAgentId({ clientId: input.clientId, agentId: input.agentId }).catch(() => null),
    listAgentGitHubConnections(input.clientId, input.agentId).catch(() => []),
    listKbSourcesByClientId(input.clientId).catch(() => []),
    getPartnerSetting({ partner: "openai", key: "default" }).catch(() => null),
  ]);

  const gh = (ghConnections ?? []).map((c: any) => ({
    default_repo: String(c.default_repo ?? "").trim() || "*",
    access_level: String(c.access_level ?? "read") as GitHubAccessLevel,
  }));

  const github: GitHubToolAccess = {
    available: gh.length > 0,
    maxAccessLevel: maxGitHubAccessLevel(gh.map((c) => c.access_level)),
    repoSelectors: Array.from(new Set(gh.map((c) => c.default_repo))).filter(Boolean),
    connections: gh,
  };

  const slack: SlackToolAccess = {
    available: Boolean(slackLink),
    teamId: slackLink ? String((slackLink as any).team_id ?? "") || null : null,
    botKey: slackLink ? String((slackLink as any).bot_key ?? "") || null : null,
    dmChannelId: slackLink ? (String((slackLink as any).dm_channel_id ?? "") || null) : null,
    displayName: slackLink ? (String((slackLink as any).display_name ?? "") || null) : null,
  };

  const sourcesCount = Array.isArray(kbSources) ? kbSources.length : 0;
  const embeddingsConfigured = Boolean((openai as any)?.settings && (openai as any).settings.apiKey);
  const kb: KbToolAccess = {
    available: sourcesCount > 0,
    sourcesCount,
    embeddingsConfigured,
  };

  return { github, slack, kb };
}

export function formatToolAccessSummary(summary: ToolAccessSummary): string {
  const lines: string[] = [];

  if (summary.github.available) {
    const repos =
      summary.github.repoSelectors.length === 0 ? "(unknown repos)" : summary.github.repoSelectors.join(", ");
    lines.push(
      `- GitHub: available (max access: ${summary.github.maxAccessLevel ?? "unknown"}; repos: ${repos})`
    );
  } else {
    lines.push("- GitHub: not linked");
  }

  if (summary.slack.available) {
    lines.push(`- Chat: Slack linked (bot: ${summary.slack.botKey ?? "unknown"})`);
  } else {
    lines.push("- Chat: Slack not linked");
  }

  if (summary.kb.available) {
    lines.push(
      `- Knowledge base: available (sources: ${summary.kb.sourcesCount}; embeddings: ${summary.kb.embeddingsConfigured ? "configured" : "not configured"})`
    );
  } else {
    lines.push("- Knowledge base: not synced");
  }

  return lines.join("\n");
}

