import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { getClientIdFromSession } from "@/lib/session";

export default async function DashboardHome() {
  const session = await getServerSession(authOptions);
  const userEmail = (session as any)?.user?.email as string | undefined;
  const clientId = getClientIdFromSession(session);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Client dashboard
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          You’re signed in as <span className="font-medium">{userEmail ?? "unknown"}</span>.
        </p>
        <p className="mt-1 text-sm text-zinc-600">
          Next: we’ll display and manage your agents here.
        </p>

        <div className="mt-6">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/app/personas"
              className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Personas
            </Link>
            <Link
              href="/app/integrations/slack"
              className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Slack integration
            </Link>
            <Link
              href="/app/agents"
              className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              All agents
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

