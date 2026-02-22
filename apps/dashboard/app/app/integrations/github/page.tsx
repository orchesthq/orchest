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

type GitHubAppCheck =
  | { ok: true; app: { id: number; slug: string; name: string } }
  | { ok: false; error: string };

export default async function GitHubIntegrationPage(props: {
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

  const searchParams = (await props.searchParams) ?? {};
  const error = typeof searchParams.error === "string" ? searchParams.error : null;
  const github = typeof searchParams.github === "string" ? searchParams.github : null;
  const returnTo = typeof searchParams.returnTo === "string" ? searchParams.returnTo : "";

  let status: GitHubStatus | null = null;
  try {
    status = await apiFetchForClient<GitHubStatus>(clientId, "/internal/github/status", {
      method: "GET",
    });
  } catch {
    status = null;
  }

  let appCheck: GitHubAppCheck | null = null;
  if (error === "github_install_failed" || error === "github_install_url_failed") {
    try {
      appCheck = await apiFetchForClient<GitHubAppCheck>(clientId, "/internal/github/app-check", {
        method: "GET",
      });
    } catch {
      appCheck = null;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">GitHub</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Connect your organization to GitHub so agents can create branches, commit, and open PRs. Each agent is linked separately with its own repo and permissions.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 shadow-sm">
          <div className="font-medium">GitHub action failed</div>
          <div className="mt-2 text-xs text-amber-900">
            {error === "github_install_url_failed"
              ? "Couldn’t start the GitHub connect flow. This usually means the GitHub App settings are missing or the private key format is invalid."
              : error === "github_install_failed"
                ? "GitHub connection failed while exchanging the installation for a token. Check the API logs (often private key formatting)."
                : error === "github_no_installation_id"
                  ? "GitHub did not redirect back with an installation id. This can happen if the app is already installed and GitHub takes you to settings instead."
                  : error === "github_invalid_installation_id"
                    ? "Installation id must be a positive number."
                    : error === "github_session_expired"
                      ? "Your connect session expired. Try connecting again."
                      : error === "github_invalid_session"
                        ? "Your connect session was invalid. Try connecting again."
                        : error === "github_disconnect_failed"
                          ? "Failed to disconnect. Check the API logs for details."
                          : "Something went wrong. Check the API logs for details."}
          </div>
          {appCheck && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-white/60 p-3 text-xs text-amber-900">
              <div className="font-medium">GitHub App auth check</div>
              <div className="mt-1 font-mono whitespace-pre-wrap">
                {appCheck.ok
                  ? `OK: ${appCheck.app.name} (id=${appCheck.app.id}, slug=${appCheck.app.slug})`
                  : `FAILED: ${appCheck.error}`}
              </div>
              {appCheck.ok && (
                <div className="mt-2">
                  If you still see JWT decode errors, double-check that the installation you selected belongs to this GitHub App.
                </div>
              )}
              {!appCheck.ok && (
                <div className="mt-2">
                  This usually means the stored `appId` doesn’t match the private key, or the PEM string is malformed.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {github === "connected" && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-900 shadow-sm">
          <div className="font-medium">GitHub connected</div>
          <div className="mt-2 text-xs">
            Your organization is now connected. Next, link individual agents to a repo from their agent pages.
          </div>
          {returnTo && returnTo !== "/app/integrations/github" && (
            <div className="mt-3">
              <Link
                href={returnTo}
                className="inline-flex items-center rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
              >
                Continue
              </Link>
            </div>
          )}
        </div>
      )}

      {github === "disconnected" && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-700 shadow-sm">
          <div className="font-medium text-zinc-900">GitHub disconnected</div>
          <div className="mt-2 text-xs text-zinc-600">
            The organization link (and all per-agent GitHub links) were removed.
          </div>
        </div>
      )}

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
                href={`/app/integrations/github/connect?returnTo=${encodeURIComponent(returnTo || "/app/integrations/github")}`}
                className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Connect GitHub
              </Link>
            )}

            {status?.configured && status?.connected && (
              <form
                action={`/app/integrations/github/disconnect?returnTo=${encodeURIComponent(
                  returnTo || "/app/integrations/github"
                )}`}
                method="post"
              >
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

      {status?.configured && !status?.connected && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">Already installed?</div>
          <p className="mt-1 text-xs text-zinc-600">
            If GitHub takes you to settings instead of redirecting back, you can manually link an existing installation by pasting its installation id
            (from `github.com/settings/installations/&lt;id&gt;`).
          </p>
          <form action="/app/integrations/github/link-existing" method="post" className="mt-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="returnTo" value={returnTo || ""} />
            <div>
              <label htmlFor="installationId" className="block text-xs font-medium text-zinc-500">
                Installation id
              </label>
              <input
                id="installationId"
                name="installationId"
                type="text"
                inputMode="numeric"
                placeholder="12345678"
                className="mt-0.5 h-9 w-56 rounded-md border border-zinc-200 px-3 text-sm"
              />
            </div>
            <button
              type="submit"
              className="h-9 rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Link installation
            </button>
          </form>
        </div>
      )}

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
