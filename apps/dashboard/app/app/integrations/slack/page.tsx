import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { ORCHEST_PERSONAS } from "@/lib/personas";
import { getClientIdFromSession } from "@/lib/session";

type SlackStatus = {
  bots: Record<
    string,
    | { connected: false }
    | { connected: true; teamId: string; teamName: string | null; installedAt: string }
  >;
};

export default async function SlackIntegrationPage() {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);

  if (!clientId) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900">No client assigned</h1>
      </div>
    );
  }

  let status: SlackStatus | null = null;
  let loadError: string | null = null;
  try {
    status = await apiFetchForClient<SlackStatus>(clientId, "/internal/slack/status", {
      method: "GET",
    });
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Slack</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Connect your Slack workspace so agents can behave like employees (DMs and @mentions).
        </p>
      </div>

      {loadError && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 shadow-sm">
          <div className="font-medium">Couldn’t load Slack status</div>
          <div className="mt-2 whitespace-pre-wrap font-mono text-xs">{loadError}</div>
        </div>
      )}

      {!loadError && status && (
        <div className="space-y-4">
          {ORCHEST_PERSONAS.map((p) => {
            const s = status?.bots?.[p.key];
            const connected = Boolean(s && (s as any).connected);

            return (
              <div
                key={p.key}
                className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
              >
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <div className="text-base font-semibold text-zinc-900">
                      {p.name}
                      <span className="ml-2 text-xs font-normal text-zinc-500">
                        ({p.key})
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-zinc-600">{p.description}</div>

                    {connected ? (
                      <div className="mt-2 text-xs text-zinc-500">
                        Connected to{" "}
                        {(s as any).teamName ?? "Slack"} ({(s as any).teamId}) at{" "}
                        {new Date((s as any).installedAt).toLocaleString()}
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-zinc-500">Not connected</div>
                    )}
                  </div>

                  {!connected ? (
                    <Link
                      href={`/app/integrations/slack/connect?bot=${encodeURIComponent(
                        p.key
                      )}`}
                      className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                    >
                      Install {p.name}
                    </Link>
                  ) : (
                    <div className="text-xs text-emerald-700">Connected</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

