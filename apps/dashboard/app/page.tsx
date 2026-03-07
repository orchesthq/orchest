import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { getClientIdFromSession } from "@/lib/session";

function FeatureCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
      <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-600">{description}</p>
    </div>
  );
}

function Step({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white">
          {number}
        </div>
        <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-6 text-zinc-600">{description}</p>
    </div>
  );
}

export default async function Home() {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);

  if (clientId) {
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
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 left-1/2 h-72 w-[48rem] -translate-x-1/2 rounded-full bg-zinc-200/40 blur-3xl" />
      </div>

      <main className="relative mx-auto max-w-6xl px-6 py-16">
        <header className="rounded-3xl border border-zinc-200/70 bg-white/70 p-10 shadow-sm backdrop-blur">
          <p className="text-sm font-medium text-zinc-500">Orchest</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl">
            A calm, safe way to run AI agents in Slack.
          </h1>
          <p className="mt-4 max-w-2xl text-zinc-600">
            Connect your knowledge and tools, then let agents answer questions and
            prepare small, reviewable actions—without turning your workflow into
            chaos.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Create account
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white/70 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
            >
              Sign in
            </Link>
            <p className="text-sm text-zinc-500 sm:ml-2">
              Works best for product, engineering, and support teams.
            </p>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-zinc-200/70 bg-white/60 px-4 py-3 text-sm text-zinc-700">
              <span className="font-medium text-zinc-900">KB Q&A</span> with links back to sources
            </div>
            <div className="rounded-2xl border border-zinc-200/70 bg-white/60 px-4 py-3 text-sm text-zinc-700">
              <span className="font-medium text-zinc-900">Summaries</span> for threads, incidents, decisions
            </div>
            <div className="rounded-2xl border border-zinc-200/70 bg-white/60 px-4 py-3 text-sm text-zinc-700">
              <span className="font-medium text-zinc-900">Guardrails</span> so humans stay in control
            </div>
          </div>
        </header>

        <section className="mt-14">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
                What you can do
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-zinc-600">
                Start small: one agent, one workflow. Expand only when its working.
              </p>
            </div>
            <p className="hidden text-sm text-zinc-500 sm:block">6 capabilities</p>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              title="Answer questions from your knowledge base"
              description="Ask in Slack and get a structured answer with links back to the source material. Great for onboarding and fewer repeated questions."
            />
            <FeatureCard
              title="Summarize threads, incidents, and decisions"
              description="Turn long Slack threads into crisp summaries, action items, and follow-ups your team can execute."
            />
            <FeatureCard
              title="Lightweight coding help (with guardrails)"
              description="Draft small changes, explain diffs, and prepare PR-ready suggestionsso engineers stay in control."
            />
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer select-none text-sm font-medium text-zinc-900 hover:text-zinc-700">
              Show more
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                title="Repeatable workflows"
                description="Standardize how your team handles common requests: support triage, release notes, weekly updates, and more."
              />
              <FeatureCard
                title="Identity + memory"
                description="Give agents a role and persistent context so they behave consistently across conversations and tasks."
              />
              <FeatureCard
                title="Built for teams"
                description="Designed for real company workflows: clear outcomes, traceability, and a path to safe automation."
              />
            </div>
          </details>
        </section>

        <section className="mt-14">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
            How it works
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            A simple setup flow that keeps the team in the loop.
          </p>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <Step
              number="1"
              title="Create an agent"
              description="Pick a role (e.g., Knowledge Base Assistant) and set the behavior you want."
            />
            <Step
              number="2"
              title="Connect Slack + sources"
              description="Install to Slack and connect the systems your team uses (docs, repos, tickets)."
            />
            <Step
              number="3"
              title="Run requests in Slack"
              description="Ask questions, request summaries, or delegate small tasks. Approve changes before they ship."
            />
          </div>
        </section>

        <section className="mt-14">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-10 shadow-sm backdrop-blur">
            <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
              Ready to try it?
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-zinc-600">
              Create an account, spin up your first agent, and connect Slack. You can
              be up and running in minutes.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/sign-up"
                className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Create account
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white/70 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900">FAQ</h2>
          <div className="mt-4 space-y-3">
            <details className="rounded-2xl border border-zinc-200/70 bg-white/70 p-5 shadow-sm backdrop-blur">
              <summary className="cursor-pointer select-none text-sm font-medium text-zinc-900">
                Is this meant to replace my team?
              </summary>
              <p className="mt-3 text-sm leading-6 text-zinc-600">
                No. Orchest is designed to help teams move faster on repetitive worksummaries, Q&A, and small, reviewable changes.
              </p>
            </details>
            <details className="rounded-2xl border border-zinc-200/70 bg-white/70 p-5 shadow-sm backdrop-blur">
              <summary className="cursor-pointer select-none text-sm font-medium text-zinc-900">
                How do you keep things safe?
              </summary>
              <p className="mt-3 text-sm leading-6 text-zinc-600">
                Start with read-only workflows. When you enable actions, keep approvals in the loop (e.g., PRs for code changes).
              </p>
            </details>
            <details className="rounded-2xl border border-zinc-200/70 bg-white/70 p-5 shadow-sm backdrop-blur">
              <summary className="cursor-pointer select-none text-sm font-medium text-zinc-900">
                Whats the fastest way to see value?
              </summary>
              <p className="mt-3 text-sm leading-6 text-zinc-600">
                Connect Slack and one source of truth (docs or a repo), then ask the agent to answer common questions with citations.
              </p>
            </details>
          </div>
        </section>

        <footer className="mt-14 pb-6 text-sm text-zinc-500">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>© {new Date().getFullYear()} Orchest</div>
            <div className="flex gap-4">
              <Link href="/sign-in" className="hover:text-zinc-700">
                Dashboard
              </Link>
              <Link href="/sign-up" className="hover:text-zinc-700">
                Create account
              </Link>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
