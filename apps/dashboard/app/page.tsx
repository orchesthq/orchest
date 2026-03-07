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
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
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
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
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
            Welcome back to Orchest HQ
          </h1>
          <p className="mt-3 text-zinc-600">
            Youre in the dashboardmanage agents, integrations, and activity.
          </p>
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
      <main className="mx-auto max-w-5xl px-6 py-16">
        <div className="rounded-2xl border border-zinc-200 bg-white p-10 shadow-sm">
          <p className="text-sm font-medium text-zinc-500">Orchest HQ</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl">
            Welcome to Orchest HQ.
          </h1>
          <p className="mt-4 max-w-2xl text-zinc-600">
            Orchest is the agent runtime. Orchest HQ is where you set things up—then
            your team works with agents in Slack.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Create your first agent
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Sign in
            </Link>
          </div>

          <div className="mt-6 flex flex-col gap-2 text-sm text-zinc-600 sm:flex-row sm:items-center sm:gap-6">
            <div>
              <span className="font-medium text-zinc-900">Use cases:</span> KB Q&A,
              incident triage, PR summaries, small fixes.
            </div>
            <div>
              <span className="font-medium text-zinc-900">Teams:</span> product,
              engineering, support.
            </div>
          </div>
        </div>

        <section className="mt-12">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
            What you can do with Orchest
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            Start with a single agent in Slack. Connect your sources of truth, then
            let the agent answer with context and take small, reviewable actions.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              title="Answer questions from your knowledge base"
              description="Ask in Slack and get a structured answer with links back to the source material. Great for onboarding and reducing repeated questions."
            />
            <FeatureCard
              title="Summarize threads, incidents, and decisions"
              description="Turn long Slack threads into crisp summaries, action items, and follow-ups your team can actually execute."
            />
            <FeatureCard
              title="Lightweight coding help (with guardrails)"
              description="Draft small changes, explain diffs, and prepare PR-ready suggestions—so engineers stay in control."
            />
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
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
            How it works
          </h2>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <Step
              number="1"
              title="Create an agent"
              description="Pick a role (e.g., Knowledge Base Assistant or Engineering Helper) and set the behavior you want."
            />
            <Step
              number="2"
              title="Connect Slack + your sources"
              description="Install to Slack and connect the systems your team uses (docs, repos, tickets)."
            />
            <Step
              number="3"
              title="Run workflows in Slack"
              description="Ask questions, request summaries, or delegate small tasks. Keep humans in the loop for approvals."
            />
          </div>
        </section>

        <section className="mt-12">
          <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
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
                className="inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>

        <footer className="mt-12 pb-6 text-sm text-zinc-500">
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
