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
import { PendingForm } from "@/components/PendingForm";
import { PendingSubmitButton } from "@/components/PendingSubmitButton";
import { LoadingLink } from "@/components/LoadingLink";

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
  default_repo: string;
};

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
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
  let githubConnections: GitHubConnection[] = [];
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
      const connResp = await apiFetchForClient<{ connections: GitHubConnection[] }>(
        clientId,
        `/internal/github/agents/${agentIdParsed.data}/connections`,
        { method: "GET" }
      );
      githubConnections = connResp.connections ?? [];
    } catch {
      githubConnections = [];
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
          <LoadingLink
            href="/app/agents"
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            pendingText="Back…"
          >
            Back
          </LoadingLink>
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
  const sp = (await searchParams) ?? {};
  const githubBanner = typeof sp.github === "string" ? sp.github : undefined;
  const errorBanner = typeof sp.error === "string" ? sp.error : undefined;
  const errorDetails = typeof sp.details === "string" ? sp.details : undefined;

  return (
    <div className="space-y-6">
      {githubBanner || errorBanner ? (
        <div
          className={[
            "rounded-2xl border p-4 text-sm shadow-sm",
            errorBanner ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900",
          ].join(" ")}
        >
          {errorBanner ? (
            <div>
              {errorBanner === "github_repo_required" ? "Select a repository (or choose 'All repos')." : null}
              {errorBanner === "github_link_failed" ? "GitHub link failed. Check the API logs for details." : null}
              {errorBanner === "github_unlink_failed" ? "GitHub unlink failed. Check the API logs for details." : null}
              {errorBanner === "github_update_failed" ? "GitHub update failed. Check the API logs for details." : null}
              {errorBanner === "github_remove_link_failed" ? "Removing that GitHub link failed. Check the API logs for details." : null}
              {errorBanner === "agent_disable_failed" ? "Disable failed. Check the details below (and API logs)." : null}
              {![
                "github_repo_required",
                "github_link_failed",
                "github_unlink_failed",
                "github_update_failed",
                "github_remove_link_failed",
                "agent_disable_failed",
              ].includes(
                errorBanner
              )
                ? `Action failed: ${errorBanner}`
                : null}
              {errorBanner === "agent_disable_failed" && errorDetails ? (
                <div className="mt-2 whitespace-pre-wrap font-mono text-xs opacity-80">{errorDetails}</div>
              ) : null}
            </div>
          ) : (
            <div>
              {githubBanner === "linked" ? "GitHub repo link saved." : null}
              {githubBanner === "unlinked" ? "GitHub link removed." : null}
              {githubBanner === "updated" ? "GitHub repo link updated." : null}
              {githubBanner === "removed" ? "GitHub repo link removed." : null}
            </div>
          )}
        </div>
      ) : null}

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
        <LoadingLink
          href="/app/agents"
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          pendingText="Back…"
        >
          Back
        </LoadingLink>
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
          <LoadingLink
            href={`/app/integrations/slack/connect?bot=${encodeURIComponent(botKey)}&agentId=${encodeURIComponent(agentIdParsed.data)}`}
            prefetch={false}
            className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            pendingText="Opening Slack…"
          >
            {isLinked ? "Reinstall in Slack" : "Install in Slack"}
          </LoadingLink>
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
              href={`/app/integrations/github?returnTo=${encodeURIComponent(`/app/agents/${agentIdParsed.data}`)}`}
              className="inline-flex w-fit items-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Go to GitHub integration
            </Link>
          ) : githubRepos.length === 0 ? (
            <p className="text-xs text-amber-700">
              No repositories found. Ensure the Orchest GitHub App has access to at least one repository, then refresh.
            </p>
          ) : (
            <div className="space-y-4">
              {githubConnections.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm text-zinc-700">
                    Linked repos:{" "}
                    <span className="font-medium">
                      {githubConnections.some((c) => c.default_repo === "*")
                        ? "All repos"
                        : `${githubConnections.length} repo${githubConnections.length === 1 ? "" : "s"}`}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {githubConnections.map((c, idx) => (
                      <div key={c.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                        <div className="mb-3 text-xs font-medium text-zinc-500">Repo link #{idx + 1}</div>
                        <div className="flex flex-wrap items-end gap-3">
                          <PendingForm action={`/app/agents/${agentIdParsed.data}/github/link`} method="post">
                            <input type="hidden" name="connectionId" value={c.id} />
                            <div className="flex flex-wrap items-end gap-3">
                              <div>
                                <label className="block text-xs font-medium text-zinc-500">Repository</label>
                                <select
                                  name="defaultRepo"
                                  className="mt-0.5 h-9 rounded-md border border-zinc-200 px-3 text-sm"
                                  defaultValue={c.default_repo}
                                >
                                  <option value="*">All repos</option>
                                  {githubRepos.map((r) => (
                                    <option key={r.full_name} value={r.full_name}>
                                      {r.full_name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-zinc-500">Access</label>
                                <select
                                  name="accessLevel"
                                  className="mt-0.5 h-9 rounded-md border border-zinc-200 px-3 text-sm"
                                  defaultValue={c.access_level}
                                >
                                  <option value="read">Read only</option>
                                  <option value="pr_only">PR only (recommended)</option>
                                  <option value="direct_push">Direct push</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-zinc-500">Commit author name</label>
                                <input
                                  name="commitAuthorName"
                                  type="text"
                                  defaultValue={c.commit_author_name}
                                  className="mt-0.5 h-9 rounded-md border border-zinc-200 px-3 text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-zinc-500">Commit author email</label>
                                <input
                                  name="commitAuthorEmail"
                                  type="email"
                                  defaultValue={c.commit_author_email}
                                  className="mt-0.5 h-9 rounded-md border border-zinc-200 px-3 text-sm"
                                />
                              </div>
                              <PendingSubmitButton
                                pendingText="Saving…"
                                className="h-9 rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                              >
                                Update
                              </PendingSubmitButton>
                            </div>
                          </PendingForm>

                          <PendingForm action={`/app/agents/${agentIdParsed.data}/github/unlink`} method="post">
                            <input type="hidden" name="connectionId" value={c.id} />
                            <PendingSubmitButton
                              pendingText="Removing…"
                              className="h-9 rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                            >
                              Remove link
                            </PendingSubmitButton>
                          </PendingForm>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                <div className="mb-3 text-xs font-medium text-zinc-500">
                  {githubConnections.length > 0 ? "Add repo link" : "Link to GitHub"}
                </div>
                <PendingForm action={`/app/agents/${agentIdParsed.data}/github/link`} method="post">
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-500">Repository *</label>
                      <select
                        name="defaultRepo"
                        required
                        className="mt-0.5 h-9 rounded-md border border-zinc-200 px-3 text-sm"
                        defaultValue=""
                      >
                        <option value="">Select repository</option>
                        <option value="*">All repos</option>
                        {githubRepos.map((r) => (
                          <option key={r.full_name} value={r.full_name}>
                            {r.full_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-500">Access</label>
                      <select
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
                      <label className="block text-xs font-medium text-zinc-500">Commit author name</label>
                      <input
                        name="commitAuthorName"
                        type="text"
                        defaultValue={githubConnections[0]?.commit_author_name ?? agentResp.agent.name}
                        className="mt-0.5 h-9 rounded-md border border-zinc-200 px-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-500">Commit author email</label>
                      <input
                        name="commitAuthorEmail"
                        type="email"
                        defaultValue={
                          githubConnections[0]?.commit_author_email ??
                          `${agentResp.agent.name.toLowerCase().replace(/\s+/g, "-")}@agents.orchest.io`
                        }
                        className="mt-0.5 h-9 rounded-md border border-zinc-200 px-3 text-sm"
                      />
                    </div>
                    <PendingSubmitButton
                      pendingText="Linking…"
                      className="h-9 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                    >
                      {githubConnections.length > 0 ? "Add link" : "Link to GitHub"}
                    </PendingSubmitButton>
                  </div>
                </PendingForm>
              </div>

              {githubConnections.length > 0 ? (
                <div className="pt-1">
                  <PendingForm action={`/app/agents/${agentIdParsed.data}/github/unlink`} method="post">
                    <PendingSubmitButton
                      pendingText="Removing…"
                      className="h-9 rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                    >
                      Remove all GitHub links
                    </PendingSubmitButton>
                  </PendingForm>
                </div>
              ) : null}
            </div>
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

