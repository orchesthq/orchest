import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";

type Agent = {
  id: string;
  name: string;
  role: string;
  created_at: string;
};

export default async function AgentsPage() {
  const session = await getServerSession(authOptions);
  const clientId = session?.user?.clientId;

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

  let data: { agents: Agent[] } | null = null;
  let loadError: string | null = null;
  try {
    data = await apiFetchForClient<{ agents: Agent[] }>(clientId, "/agents", {
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
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Agents</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Your digital employees. Personas have fixed names; you can configure role and personality.
            </p>
          </div>
          <Link
            href="/app/agents/new"
            className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Hire persona
          </Link>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 shadow-sm">
          <div className="font-medium">Couldn’t load agents</div>
          <div className="mt-2 whitespace-pre-wrap font-mono text-xs">{loadError}</div>
          <div className="mt-3 text-xs text-amber-800">
            This usually means the API is not configured (Fly secrets) or the dashboard’s
            `API_BASE_URL` is pointing somewhere unexpected.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Agents</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Your digital employees. Personas have fixed names; you can configure role and personality.
          </p>
        </div>
        <Link
          href="/app/agents/new"
          className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Hire persona
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data!.agents.map((a) => (
          <Link
            key={a.id}
            href={`/app/agents/${a.id}`}
            className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm hover:border-zinc-300"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-base font-semibold text-zinc-900">{a.name}</div>
                <div className="mt-1 text-sm text-zinc-600">{a.role}</div>
              </div>
              <div className="text-xs text-zinc-500">View</div>
            </div>
          </Link>
        ))}

        {data!.agents.length === 0 && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm">
            No agents yet. Hire your first persona.
          </div>
        )}
      </div>
    </div>
  );
}

