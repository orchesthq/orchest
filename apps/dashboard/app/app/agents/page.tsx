import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { getClientIdFromSession } from "@/lib/session";
import { ORCHEST_PERSONAS } from "@/lib/personas";
import { getTemplateByRole } from "@/lib/agentTemplates";
import Image from "next/image";
import { AgentCardActions } from "./AgentCardActions";

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

export default async function AgentsPage() {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);

  if (!clientId) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900">No client assigned</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Your user doesn’t have a client membership yet.
        </p>
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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Agents</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Hire and manage your five Orchest AI employees. Each is hard-linked to a persona; you can change role and behaviour.
          </p>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 shadow-sm">
          <div className="font-medium">Couldn’t load agents</div>
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Agents</h1>
        <p className="mt-1 text-sm text-zinc-600">
          All five Orchest personas. Hire or disable each one; change role and personality from Manage. Enable Slack access per agent.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ORCHEST_PERSONAS.map((p) => {
          const agent = agentByPersona.get(p.key) ?? null;
          const bot = slackStatus?.bots?.[p.key];
          const slackConnected = Boolean(bot && (bot as { connected?: boolean }).connected);

          return (
            <div
              key={p.key}
              className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border-2 border-zinc-100 ring-2 ring-zinc-200/50">
                    <Image
                      src={p.imagePath}
                      alt={p.name}
                      fill
                      className="object-cover"
                      sizes="56px"
                    />
                  </div>
                  <div>
                    <div className="text-base font-semibold text-zinc-900">{p.name}</div>
                    <div className="mt-1 text-sm text-zinc-600">{p.description}</div>
                  </div>
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
                  <div className="text-zinc-700">Slack</div>
                  {slackConnected ? (
                    <div className="text-emerald-700">Installed</div>
                  ) : (
                    <div className="text-zinc-500">Not installed</div>
                  )}
                </div>

                {agent ? (
                  <div className="flex items-center justify-between">
                    <div className="text-zinc-700">Role</div>
                    <div className="text-zinc-600">
                      {getTemplateByRole(agent.role)?.label ?? agent.role}
                    </div>
                  </div>
                ) : null}
              </div>

              <AgentCardActions
                personaKey={p.key}
                personaName={p.name}
                agent={agent}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
