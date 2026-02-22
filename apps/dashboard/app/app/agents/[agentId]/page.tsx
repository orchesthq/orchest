import Link from "next/link";
import Image from "next/image";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { AgentEditor } from "./AgentEditor";
import { DisableButton } from "./DisableButton";
import { z } from "zod";
import { getClientIdFromSession } from "@/lib/session";
import { getPersonaByKey } from "@/lib/personas";

type Agent = {
  id: string;
  persona_key?: string | null;
  name: string;
  role: string;
  system_prompt: string;
};

type Memory = {
  id: string;
  memory_type: "profile" | "episodic" | "semantic";
  content: string;
  created_at: string;
};

type SlackLink = {
  id: string;
  dm_channel_id: string | null;
  team_id: string;
  bot_key?: string;
  display_name: string;
  icon_url: string | null;
  created_at: string;
};

type SlackStatus = {
  bots: Record<
    string,
    | { connected: false }
    | { connected: true; teamId: string; teamName: string | null; installedAt: string }
  >;
};

type GitHubStatus = {
  connected: boolean;
  configured?: boolean;
  ownerLogin?: string;
};

type GitHubConnection = {
  id: string;
  commit_author_name: string;
  commit_author_email: string;
  access_level: string;
  default_branch: string;
  default_repo: string | null;
};

export default async function AgentPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);

  if (!clientId) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900">No client assigned</h1>
      </div>
    );
  }

  const { agentId } = await params;
  const agentIdParsed = z.string().uuid().safeParse(agentId);
  if (!agentIdParsed.success) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900">Invalid agent id</h1>
      </div>
    );
  }

  let agentResp: { agent: Agent } | null = null;
  let memResp: { memories: Memory[] } | null = null;
  let slackStatus: SlackStatus | null = null;
  let slackLink: SlackLink | null = null;
  let githubStatus: GitHubStatus | null = null;
  let githubConnection: GitHubConnection | null = null;
  let githubRepos: Array<{ full_name: string }> = [];
  let loadError: string | null = null;
  try {
    agentResp = await apiFetchForClient<{ agent: Agent }>(
      clientId,
      `/agents/${agentIdParsed.data}`,
      { method: "GET" }
    );

    memResp = await apiFetchForClient<{ memories: Memory[] }>(
      clientId,
      `/agents/${agentIdParsed.data}/memories?memoryType=profile&limit=1`,
      { method: "GET" }
    );

    slackStatus = await apiFetchForClient<SlackStatus>(clientId, "/internal/slack/status", {
      method: "GET",
    });

    const botKey = agentResp?.agent?.persona_key ?? "ava";
    try {
      const linkResp = await apiFetchForClient<{ link: SlackLink }>(
        clientId,
        `/internal/slack/agents/${agentIdParsed.data}/link?bot=${encodeURIComponent(botKey)}`,
        { method: "GET" }
      );
      slackLink = linkResp.link ?? null;
    } catch {
      slackLink = null;
    }

    try {
      githubStatus = await apiFetchForClient<GitHubStatus>(clientId, "/internal/github/status", {
        method: "GET",
      });
    } catch {
      githubStatus = null;
    }

    try {
      const connResp = await apiFetchForClient<{ connection: GitHubConnection }>(
        clientId,
        `/internal/github/agents/${agentIdParsed.data}/connection`,
        { method: "GET" }
      );
      githubConnection = connResp.connection ?? null;
    } catch {
      githubConnection = null;
    }

  if (githubStatus?.connected) {
    try {
      const reposResp = await apiFetchForClient<{ repos: Array<{ full_name: string }> }>(
        clientId,
        "/internal/github/repos",
        { method: "GET" }
      );
      githubRepos = reposResp.repos ?? [];
    } catch {
      githubRepos = [];
    }
  }
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  if (loadError || !agentResp) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Agent</h1>
            <p className="mt-1 text-sm text-zinc-600">Unable to load agent details.</p>
          </div>
          <Link
            href="/app/agents"
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            Back
          </Link>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 shadow-sm">
          <div className="font-medium">Couldn’t load agent</div>
          <div className="mt-2 whitespace-pre-wrap font-mono text-xs">{loadError ?? "Unknown error"}</div>
        </div>
      </div>
    );
  }

  const latestProfile = memResp?.memories?.[0]?.content ?? "";
  const botKey = agentResp.agent.persona_key ?? "ava";
  const isLinked = Boolean(slackLink);
  const persona = getPersonaByKey(botKey);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {persona?.imagePath && (
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-zinc-100 ring-2 ring-zinc-200/50">
              <Image
                src={persona.imagePath}
                alt={agentResp.agent.name}
                fill
                className="object-cover"
                sizes="64px"
              />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              {agentResp.agent.name}
            </h1>
            <p className="mt-1 text-sm text-zinc-600">{agentResp.agent.role}</p>
          </div>
        </div>
        <Link
          href="/app/agents"
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
        >
          Back
        </Link>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <AgentEditor
          agentId={agentResp.agent.id}
          initialName={agentResp.agent.name}
          initialRole={agentResp.agent.role}
          initialSystemPrompt={agentResp.agent.system_prompt}
          initialProfileMemory={latestProfile}
          personaKey={agentResp.agent.persona_key ?? null}
        />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Slack</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Install this agent in Slack so it can receive DMs and @mentions. It will be linked to the {agentResp.agent.name} bot.
            </p>
          </div>
          <Link
            href={`/app/integrations/slack/connect?bot=${encodeURIComponent(botKey)}&agentId=${encodeURIComponent(agentIdParsed.data)}`}
            className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            {isLinked ? "Reinstall in Slack" : "Install in Slack"}
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">GitHub</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Link this agent to GitHub so it can create branches, commit, and open PRs. Each agent appears as a separate user in GitHub (via commit author).
            </p>
          </div>

          {!githubStatus?.configured ? (
            <p className="text-xs text-zinc-500">
              GitHub integration is not configured in the API.
            </p>
          ) : !githubStatus?.connected ? (
            <Link
              href={`/app/integrations/github/connect?returnTo=${encodeURIComponent(`/app/agents/${agentIdParsed.data}`)}`}
              className="inline-flex w-fit items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Connect GitHub
            </Link>
          ) : githubConnection ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-emerald-700">
                <span>Linked to</span>
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs">
                  {githubConnection.default_repo ?? "(no repo)"}
                </code>
                <span>({githubConnection.access_level})</span>
                <span>as</span>
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs">
                  {githubConnection.commit_author_name} &lt;{githubConnection.commit_author_email}&gt;
                </code>
              </div>
              <form action={`/app/agents/${agentIdParsed.data}/github/link`} method="post">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label htmlFor="defaultRepo" className="block text-xs font-medium text-zinc-500">
                      Repository
                    </label>
                    <select
                      id="defaultRepo"
                      name="defaultRepo"
                      className="mt-0.5 h-9 rounded-md border border-zinc-200 px-3 text-sm"
                      defaultValue={githubConnection.default_repo ?? ""}
                    >
                      {githubRepos.map((r) => (
                        <option key={r.full_name} value={r.full_name}>
                          {r.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="accessLevel" className="block text-xs font-medium text-zinc-500">
                      Access
                    </label>
                    <select
                      id="accessLevel"
                      name="accessLevel"
                      className="mt-0.5 h-9 rounded-md border border-zinc-200 px-3 text-sm"
                      defaultValue={githubConnection.access_level}
                    >
                      <option value="read">Read only</option>
                      <option value="pr_only">PR only (recommended)</option>
                      <option value="direct_push">Direct push</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="commitAuthorName" className="block text-xs font-medium text-zinc-500">
                      Commit author name
                    </label>
                    <input
                      id="commitAuthorName"
                      name="commitAuthorName"
                      type="text"
                      defaultValue={githubConnection.commit_author_name}
                      className="mt-0.5 h-9 rounded-md border border-zinc-200 px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="commitAuthorEmail" className="block text-xs font-medium text-zinc-500">
                      Commit author email
                    </label>
                    <input
                      id="commitAuthorEmail"
                      name="commitAuthorEmail"
                      type="email"
                      defaultValue={githubConnection.commit_author_email}
                      className="mt-0.5 h-9 rounded-md border border-zinc-200 px-3 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    className="h-9 rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                  >
                    Update
                  </button>
                </div>
              </form>
            </div>
          ) : githubRepos.length === 0 ? (
            <p className="text-xs text-amber-700">
              No repositories found. Ensure the Orchest GitHub App has access to at least one repository, then refresh.
            </p>
          ) : (
            <form action={`/app/agents/${agentIdParsed.data}/github/link`} method="post">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="defaultRepo" className="block text-xs font-medium text-zinc-500">
                    Repository *
                  </label>
                  <select
                    id="defaultRepo"
                    name="defaultRepo"
                    required
                    className="mt-0.5 h-9 rounded-md border border-zinc-200 px-3 text-sm"
                  >
                    <option value="">Select repository</option>
                    {githubRepos.map((r) => (
                      <option key={r.full_name} value={r.full_name}>
                        {r.full_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="accessLevel" className="block text-xs font-medium text-zinc-500">
                    Access
                  </label>
                  <select
                    id="accessLevel"
                    name="accessLevel"
                    className="mt-0.5 h-9 rounded-md border border-zinc-200 px-3 text-sm"
                    defaultValue="pr_only"
                  >
                    <option value="read">Read only</option>
                    <option value="pr_only">PR only (recommended)</option>
                    <option value="direct_push">Direct push</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="commitAuthorName" className="block text-xs font-medium text-zinc-500">
                    Commit author name
                  </label>
                  <input
                    id="commitAuthorName"
                    name="commitAuthorName"
                    type="text"
                    defaultValue={agentResp.agent.name}
                    className="mt-0.5 h-9 rounded-md border border-zinc-200 px-3 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="commitAuthorEmail" className="block text-xs font-medium text-zinc-500">
                    Commit author email
                  </label>
                  <input
                    id="commitAuthorEmail"
                    name="commitAuthorEmail"
                    type="email"
                    defaultValue={`${agentResp.agent.name.toLowerCase().replace(/\s+/g, "-")}@agents.orchest.io`}
                    className="mt-0.5 h-9 rounded-md border border-zinc-200 px-3 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  className="h-9 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  Link to GitHub
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Disable agent</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Remove this agent. Tasks and memories will be deleted. You can hire again later.
            </p>
          </div>
          <form action={`/app/agents/${agentIdParsed.data}/disable`} method="post">
            <DisableButton />
          </form>
        </div>
      </div>
    </div>
  );
}

