import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { SignOutButton } from "./SignOutButton";
import { apiGetClientById } from "@/lib/internalApi";
import { getClientIdFromSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  const clientName =
    clientId != null ? (await apiGetClientById({ clientId }).catch(() => null))?.name : null;

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/app" className="text-sm font-semibold text-zinc-900">
              Orchest
            </Link>
            <Link href="/app/agents" className="text-sm text-zinc-600 hover:text-zinc-900">
              Agents
            </Link>
            <span className="text-xs text-zinc-500">
              {clientName ? `Client: ${clientName}` : `Client: ${clientId ?? "unknown"}`}
            </span>
          </div>
          <SignOutButton />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}

