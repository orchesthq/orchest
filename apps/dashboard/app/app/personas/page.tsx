import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { ORCHEST_PERSONAS } from "@/lib/personas";
import { getClientIdFromSession } from "@/lib/session";

type Agent = {
  id: string;
  persona_key?: string | null;
  name: string;
  role: string;
  created_at: string;
};

type SlackStatus = {
  bots: Record<
    string,
    | { connected: false }
    | { connected: true; teamId: string; teamName: string | null; installedAt: string }
  >;
};

export default async function PersonasPage() {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);

  if (!clientId) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900">No client assigned</h1>
      </div>
    );
  }

  let agents: Agent[] = [];
  let slackStatus: SlackStatus | null = null;
  let loadError: string | null = null;
  try {
    const agentsResp = await apiFetchForClient<{ agents: Agent[] }>(clientId, "/agents", {
      method: "GET",
    });
    agents = agentsResp.agents ?? [];

    slackStatus = await apiFetchForClient<SlackStatus>(clientId, "/internal/slack/status", {
      method: "GET",
    });
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Personas</h1>
            <p className="mt-1 text-sm text-zinc-600">Hire and manage your Orchest AI employees.</p>
          </div>
          <Link
            href="/app/integrations/slack"
            className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            Slack integration
          </Link>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 shadow-sm">
          <div className="font-medium">Couldn’t load personas</div>
          <div className="mt-2 whitespace-pre-wrap font-mono text-xs">{loadError}</div>
        </div>
      </div>
    );
  }

  const agentByPersona = new Map<string, Agent>();
  for (const a of agents) {
    const k = a.persona_key ?? null;
    if (k && !agentByPersona.has(k)) agentByPersona.set(k, a);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Personas</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Hire Ava, Ben, Priya, Sofia, and Amira. Names are fixed; role and personality are configurable.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/app/agents"
            className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            All agents
          </Link>
          <Link
            href="/app/integrations/slack"
            className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            Slack integration
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ORCHEST_PERSONAS.map((p) => {
          const agent = agentByPersona.get(p.key) ?? null;
          const bot = slackStatus?.bots?.[p.key];
          const slackConnected = Boolean(bot && (bot as any).connected);

          return (
            <div
              key={p.key}
              className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-base font-semibold text-zinc-900">{p.name}</div>
                  <div className="mt-1 text-sm text-zinc-600">{p.description}</div>
                </div>
                <div className="text-xs text-zinc-500">{p.key}</div>
              </div>

              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <div className="text-zinc-700">Status</div>
                  {agent ? (
                    <div className="text-emerald-700">Hired</div>
                  ) : (
                    <div className="text-zinc-500">Not hired</div>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-zinc-700">Slack bot</div>
                  {slackConnected ? (
                    <div className="text-emerald-700">Installed</div>
                  ) : (
                    <div className="text-zinc-500">Not installed</div>
                  )}
                </div>

                {agent ? (
                  <div className="flex items-center justify-between">
                    <div className="text-zinc-700">Current role</div>
                    <div className="text-zinc-600">{agent.role}</div>
                  </div>
                ) : null}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                {!agent ? (
                  <Link
                    href={`/app/agents/new?persona=${encodeURIComponent(p.key)}`}
                    className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                  >
                    Hire
                  </Link>
                ) : (
                  <Link
                    href={`/app/agents/${agent.id}`}
                    className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                  >
                    Manage
                  </Link>
                )}

                {!slackConnected ? (
                  <Link
                    href={`/app/integrations/slack/connect?bot=${encodeURIComponent(p.key)}`}
                    className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                  >
                    Install in Slack
                  </Link>
                ) : null}

                {agent && slackConnected ? (
                  <form action={`/app/agents/${agent.id}/slack/enable`} method="post">
                    <input type="hidden" name="bot" value={p.key} />
                    <button
                      type="submit"
                      className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                    >
                      Enable in Slack
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

