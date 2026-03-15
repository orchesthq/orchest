import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { SignOutButton } from "./SignOutButton";
import { AppNav } from "./AppNav";
import { apiGetClientById } from "@/lib/internalApi";
import { getClientIdFromSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  const userEmail = (session?.user as { email?: string })?.email ?? null;
  const clientName =
    clientId != null ? (await apiGetClientById({ clientId }).catch(() => null))?.name : null;

  const initial = userEmail ? userEmail[0].toUpperCase() : "?";

  return (
    <div className="flex min-h-screen bg-zinc-950">
      {/* ── Sidebar ────────────────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-zinc-800 bg-zinc-900">
        {/* Logo */}
        <div className="flex h-14 shrink-0 items-center border-b border-zinc-800 px-5">
          <Link href="/app" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-sm font-bold text-white">
              O
            </span>
            <span className="text-sm font-bold tracking-tight text-white">Orchest</span>
          </Link>
        </div>

        {/* Workspace badge */}
        {clientName && (
          <div className="border-b border-zinc-800 px-5 py-3">
            <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
              Workspace
            </p>
            <p className="mt-0.5 truncate text-sm font-medium text-zinc-300">{clientName}</p>
          </div>
        )}

        {/* Nav */}
        <AppNav />

        {/* User + sign-out */}
        <div className="shrink-0 border-t border-zinc-800 p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-700 text-xs font-bold text-white">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-zinc-400">{userEmail ?? "unknown"}</p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </aside>

      {/* ── Content area ───────────────────────────────────────────────── */}
      <div className="flex min-h-screen flex-1 flex-col pl-60">
        <main className="flex-1 bg-zinc-50">
          <div className="mx-auto max-w-5xl px-8 py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
