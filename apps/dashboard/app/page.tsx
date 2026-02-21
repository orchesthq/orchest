import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (session?.user?.clientId) {
    // Middleware also protects /app, but this improves the default landing experience.
    return (
      <div className="min-h-screen bg-zinc-50">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            Welcome back
          </h1>
          <p className="mt-3 text-zinc-600">Jump into your client dashboard.</p>
          <div className="mt-8">
            <Link
              href="/app"
              className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto max-w-4xl px-6 py-16">
        <div className="rounded-2xl border border-zinc-200 bg-white p-10 shadow-sm">
          <p className="text-sm font-medium text-zinc-500">Orchest</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-900">
            Hire AI agents as digital employees
          </h1>
          <p className="mt-4 max-w-2xl text-zinc-600">
            Onboard agents with identity and memory. Assign tasks and track outcomes.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Create account
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Sign in
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
