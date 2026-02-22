import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { getClientIdFromSession } from "@/lib/session";

type GitHubStatus = {
  connected: boolean;
  configured?: boolean;
  ownerLogin?: string;
};

export default async function GitHubIntegrationPage() {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);

  if (!clientId) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900">No client assigned</h1>
      </div>
    );
  }

  let status: GitHubStatus | null = null;
  try {
    status = await apiFetchForClient<GitHubStatus>(clientId, "/internal/github/status", {
      method: "GET",
    });
  } catch {
    status = null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">GitHub</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Connect your organization to GitHub so agents can create branches, commit, and open PRs. Each agent is linked separately with its own repo and permissions.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-base font-semibold text-zinc-900">Organization connection</div>
            <div className="mt-1 text-sm text-zinc-600">
              {status?.configured === false ? (
                <>GitHub integration is not configured in the API.</>
              ) : status?.connected ? (
                <>Connected to <strong>{status.ownerLogin}</strong></>
              ) : (
                <>Install the Orchest GitHub App on your organization to get started.</>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status?.configured && !status?.connected && (
              <Link
                href={`/app/integrations/github/connect?returnTo=${encodeURIComponent("/app/integrations/github")}`}
                className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Connect GitHub
              </Link>
            )}

            {status?.configured && status?.connected && (
              <form action="/app/integrations/github/disconnect" method="post">
                <button
                  type="submit"
                  className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                >
                  Disconnect
                </button>
              </form>
            )}
          </div>
        </div>
        {status?.connected && (
          <p className="mt-3 text-xs text-zinc-500">
            Disconnecting will unlink this organization and remove all per-agent GitHub links for this client. You can reconnect any time.
          </p>
        )}
      </div>

      <p className="text-sm text-zinc-500">
        After connecting, go to each agent&apos;s page to link them to a specific repository and set access level (read / PR-only / direct push).
      </p>

      <Link
        href="/app/agents"
        className="inline-flex items-center text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        ← Back to Agents
      </Link>
    </div>
  );
}
