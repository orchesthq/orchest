import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { AgentEditor } from "./AgentEditor";
import { z } from "zod";

type Agent = {
  id: string;
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
  display_name: string;
  icon_url: string | null;
  created_at: string;
};

export default async function AgentPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const session = await getServerSession(authOptions);
  const clientId = session?.user?.clientId;

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
  let slackLinkResp: { link: SlackLink | null } | null = null;
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

    slackLinkResp = await apiFetchForClient<{ link: SlackLink | null }>(
      clientId,
      `/internal/slack/agents/${agentIdParsed.data}/link`,
      { method: "GET" }
    );
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
  const slackLink = slackLinkResp?.link ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            {agentResp.agent.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-600">{agentResp.agent.role}</p>
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
        />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Slack</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Enable this agent in Slack to create a DM and send an onboarding message.
            </p>
            {slackLink?.dm_channel_id ? (
              <p className="mt-2 text-xs text-emerald-700">
                Enabled (DM channel: {slackLink.dm_channel_id})
              </p>
            ) : (
              <p className="mt-2 text-xs text-zinc-500">Not enabled yet.</p>
            )}
          </div>

          <form action={`/app/agents/${agentIdParsed.data}/slack/enable`} method="post">
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Enable in Slack
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

