import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { getClientIdFromSession } from "@/lib/session";
import { Logo, LogoMark } from "@/components/Logo";

// ─── inline icon primitives ──────────────────────────────────────────────────

function IconBolt() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
      <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.381z" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
      <path fillRule="evenodd" d="M10 1a.75.75 0 01.561.253l7 8a.75.75 0 010 .994l-7 8A.75.75 0 019.25 18h-.5a.75.75 0 01-.561-.253l-7-8a.75.75 0 010-.994l7-8A.75.75 0 0110 1zm0 2.437L4.03 10 10 16.563 15.97 10 10 3.437z" clipRule="evenodd" />
    </svg>
  );
}
function IconBrain() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 0v4m0 4v4m0 4v2M8 8l4 4 4-4" />
    </svg>
  );
}
function IconCode() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
      <path fillRule="evenodd" d="M6.28 5.22a.75.75 0 010 1.06L2.56 10l3.72 3.72a.75.75 0 01-1.06 1.06L.97 10.53a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0zm7.44 0a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L17.44 10l-3.72-3.72a.75.75 0 010-1.06zM11.377 2.011a.75.75 0 01.612.867l-2.5 14.5a.75.75 0 01-1.478-.255l2.5-14.5a.75.75 0 01.866-.612z" clipRule="evenodd" />
    </svg>
  );
}
function IconRefresh() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
      <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
      <path d="M7 8a3 3 0 100-6 3 3 0 000 6zM14.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM1.615 16.428a1.224 1.224 0 01-.569-1.175 6.002 6.002 0 0111.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 017 17a9.953 9.953 0 01-5.385-1.572zM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 00-1.588-3.755 4.502 4.502 0 015.874 2.575c.092.335-.189.858-.57 1.006A9.966 9.966 0 0114.5 16z" />
    </svg>
  );
}
function IconSearch() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
      <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 01.208 1.04l-5 7.5a.75.75 0 01-1.154.114l-3-3a.75.75 0 011.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 011.04-.207z" clipRule="evenodd" />
    </svg>
  );
}
function IconSlack() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z" />
    </svg>
  );
}
function IconGithub() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}
function IconDocument() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
    </svg>
  );
}

// ─── reusable section components ─────────────────────────────────────────────

function NavBar() {
  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-zinc-950/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Logo iconClassName="h-8 w-8" textClassName="text-lg" />
        <div className="hidden items-center gap-8 sm:flex">
          <a href="#features" className="text-sm text-zinc-400 transition hover:text-white">Features</a>
          <a href="#how-it-works" className="text-sm text-zinc-400 transition hover:text-white">How it works</a>
          <a href="#faq" className="text-sm text-zinc-400 transition hover:text-white">FAQ</a>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/sign-in" className="text-sm text-zinc-400 transition hover:text-white">
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500"
          >
            Get started
          </Link>
        </div>
      </div>
    </nav>
  );
}

function SlackMockup() {
  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl shadow-black/60">
      {/* window bar */}
      <div className="flex items-center gap-2 border-b border-white/10 bg-zinc-800/80 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-red-500/80" />
        <span className="h-3 w-3 rounded-full bg-yellow-500/80" />
        <span className="h-3 w-3 rounded-full bg-green-500/80" />
        <div className="ml-3 flex items-center gap-2 text-xs text-zinc-400">
          <IconSlack />
          <span>#engineering — Acme Corp</span>
        </div>
      </div>
      {/* messages */}
      <div className="space-y-4 p-5 text-sm">
        {/* human message */}
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
            JS
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-white">Jake S.</span>
              <span className="text-[11px] text-zinc-500">11:03 AM</span>
            </div>
            <p className="mt-1 text-zinc-300">
              @Sophia what's our policy for handling PII in the data pipeline?
            </p>
          </div>
        </div>
        {/* agent thinking */}
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-xs font-bold text-white">
            SO
          </div>
          <div className="w-full">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-violet-400">Sophia</span>
              <span className="text-[11px] text-zinc-500">11:03 AM</span>
              <span className="rounded-full bg-violet-900/60 px-2 py-0.5 text-[10px] text-violet-300">Orchest agent</span>
            </div>
            <div className="mt-2 rounded-xl border border-violet-500/20 bg-violet-900/20 p-3">
              <p className="text-zinc-200">
                Based on your{" "}
                <span className="inline-flex items-center gap-1 rounded bg-zinc-700/60 px-1.5 py-0.5 text-[11px] text-zinc-200">
                  <IconDocument />
                  Data Governance Policy v2.3
                </span>{" "}
                (updated Jan 2025):
              </p>
              <ul className="mt-2 space-y-1.5 text-zinc-300">
                {[
                  "All PII must be encrypted at rest using AES-256 and tokenized before entering the pipeline.",
                  "Access is restricted to services with an approved DPA. Log all reads in the audit table.",
                  "Retention: 90 days in hot storage, then purge unless a legal hold applies.",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-0.5 text-violet-400"><IconCheck /></span>
                    <span className="text-sm">{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-zinc-500">Source: <span className="underline">confluence.acme.com/data-governance</span></p>
            </div>
          </div>
        </div>
        {/* follow-up */}
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-xs font-bold text-white">
            AL
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-white">Alicia L.</span>
              <span className="text-[11px] text-zinc-500">11:04 AM</span>
            </div>
            <p className="mt-1 text-zinc-300">that's exactly what I needed, thanks!</p>
          </div>
        </div>
      </div>
      {/* input hint */}
      <div className="border-t border-white/10 px-5 py-3">
        <div className="flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-500">
          <span>Message #engineering</span>
          <span className="ml-auto text-xs opacity-60">@Sophia</span>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="group rounded-2xl border border-zinc-800 bg-zinc-900 p-6 transition hover:border-zinc-700 hover:bg-zinc-800/80">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/20 text-violet-400 ring-1 ring-violet-500/30 transition group-hover:bg-violet-600/30">
        {icon}
      </div>
      <h3 className="mt-4 text-sm font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p>
    </div>
  );
}

function StepCard({
  number,
  title,
  description,
  connector,
}: {
  number: string;
  title: string;
  description: string;
  connector?: boolean;
}) {
  return (
    <div className="relative">
      {connector && (
        <div className="absolute left-[calc(50%+3rem)] top-8 hidden h-px w-[calc(100%-6rem)] bg-gradient-to-r from-violet-500/40 to-transparent lg:block" />
      )}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-600 text-sm font-bold text-white shadow-lg shadow-violet-600/40">
          {number}
        </div>
        <h3 className="mt-4 text-sm font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p>
      </div>
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-center">
      <div className="text-3xl font-bold text-white">{value}</div>
      <div className="mt-1 text-sm text-zinc-400">{label}</div>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default async function Home() {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);

  if (clientId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-10 text-center shadow-xl">
          <LogoMark className="mx-auto h-12 w-12" />
          <h1 className="mt-4 text-xl font-semibold text-white">Welcome back</h1>
          <p className="mt-2 text-sm text-zinc-400">Ready to check in on your agents?</p>
          <Link
            href="/app"
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <NavBar />

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-32 pb-20">
        {/* background glows */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-[36rem] w-[72rem] -translate-x-1/2 rounded-full bg-violet-600/10 blur-[120px]" />
          <div className="absolute -right-32 top-32 h-64 w-64 rounded-full bg-indigo-500/10 blur-[80px]" />
          <div className="absolute -left-20 bottom-0 h-64 w-64 rounded-full bg-violet-500/10 blur-[80px]" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            {/* badge */}
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 text-sm text-violet-300">
              <IconSlack />
              Built for teams that work in Slack
            </div>

            <h1 className="text-5xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
              AI agents that{" "}
              <span className="bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
                actually work
              </span>{" "}
              for your team
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
              Your AI workforce headquarters. Connect your knowledge base and tools to
              intelligent agents that answer questions, summarize threads, and get work
              done — right inside Slack, with humans always in control.
            </p>

            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
              <Link
                href="/sign-up"
                className="inline-flex w-full items-center justify-center rounded-xl bg-violet-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-violet-600/30 transition hover:bg-violet-500 sm:w-auto"
              >
                Start for free
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex w-full items-center justify-center rounded-xl border border-zinc-700 bg-zinc-800/50 px-8 py-3.5 text-base font-semibold text-zinc-200 transition hover:bg-zinc-800 sm:w-auto"
              >
                Sign in
              </Link>
            </div>

            <p className="mt-4 text-sm text-zinc-500">
              No credit card required · Up and running in minutes
            </p>
          </div>

          {/* product mockup */}
          <div className="mx-auto mt-16 max-w-2xl">
            <SlackMockup />
          </div>
        </div>
      </section>

      {/* ── Stats strip ──────────────────────────────────────────────────────── */}
      <section className="border-y border-zinc-800 py-12">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard value="< 5 min" label="Setup time" />
            <StatCard value="Any LLM" label="GPT-5, Claude, Gemini & more" />
            <StatCard value="∞" label="Knowledge sources" />
            <StatCard value="100%" label="Human approval for actions" />
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      <section id="features" className="py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-medium uppercase tracking-widest text-violet-400">Features</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Everything your team needs to delegate smarter
            </h2>
            <p className="mt-4 text-zinc-400">
              From instant Q&A to repeatable workflows — Orchest HQ handles the repetitive
              work so your team can focus on what matters.
            </p>
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={<IconSearch />}
              title="Knowledge base Q&A"
              description="Ask questions in Slack and get structured answers with direct links back to your source documents, wikis, or repos."
            />
            <FeatureCard
              icon={<IconDocument />}
              title="Thread summaries"
              description="Turn long Slack threads, incidents, and decision logs into crisp summaries with clear action items."
            />
            <FeatureCard
              icon={<IconCode />}
              title="Lightweight coding help"
              description="Draft small changes, explain diffs, and prepare PR-ready suggestions — engineers stay in full control."
            />
            <FeatureCard
              icon={<IconRefresh />}
              title="Repeatable workflows"
              description="Standardize how your team handles support triage, release notes, weekly updates, and recurring processes."
            />
            <FeatureCard
              icon={<IconBrain />}
              title="Identity & memory"
              description="Give agents a consistent role and persistent context so they behave predictably across every conversation."
            />
            <FeatureCard
              icon={<IconShield />}
              title="Built-in guardrails"
              description="Human approvals, audit trails, and balance controls ensure nothing happens without the right oversight."
            />
          </div>
        </div>
      </section>

      {/* ── Integrations ─────────────────────────────────────────────────────── */}
      <section className="border-y border-zinc-800 py-16">
        <div className="mx-auto max-w-6xl px-6">
          <p className="text-center text-sm font-medium uppercase tracking-widest text-zinc-500">
            Integrates with the tools you already use
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6">
            {[
              { icon: <IconSlack />, name: "Slack" },
              { icon: <IconGithub />, name: "GitHub" },
              { icon: <IconDocument />, name: "Confluence" },
              { icon: <IconDocument />, name: "Notion" },
              { icon: <IconBolt />, name: "Jira" },
              { icon: <IconUsers />, name: "Linear" },
            ].map(({ icon, name }) => (
              <div
                key={name}
                className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-3 text-sm text-zinc-300 transition hover:border-zinc-700"
              >
                {icon}
                {name}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-medium uppercase tracking-widest text-violet-400">How it works</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              From zero to deployed in three steps
            </h2>
            <p className="mt-4 text-zinc-400">
              No complex setup, no infrastructure to manage. Just connect, configure, and go.
            </p>
          </div>

          <div className="relative mt-14 grid gap-4 lg:grid-cols-3">
            <StepCard
              number="1"
              connector
              title="Create an agent"
              description="Pick a role — Knowledge Base Assistant, Support Triage Bot, Code Reviewer — and describe how it should behave."
            />
            <StepCard
              number="2"
              connector
              title="Connect Slack & sources"
              description="Install to your Slack workspace and connect your knowledge sources: docs, repos, or ticketing systems."
            />
            <StepCard
              number="3"
              title="Run requests in Slack"
              description="Ask questions, request summaries, or delegate tasks. Every action goes through human approval before it ships."
            />
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <section className="py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 to-indigo-700 p-12 text-center shadow-2xl">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-1/4 top-0 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
              <div className="absolute bottom-0 right-1/4 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
            </div>
            <div className="relative">
              <LogoMark className="mx-auto h-14 w-14" />
              <h2 className="mt-6 text-3xl font-bold text-white sm:text-4xl">
                Ready to give your team a superpower?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-violet-100">
                Create your account, spin up your first agent, and connect Slack.
                Most teams see value on day one.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Link
                  href="/sign-up"
                  className="inline-flex items-center justify-center rounded-xl bg-white px-8 py-3.5 text-base font-semibold text-violet-700 shadow-lg transition hover:bg-violet-50"
                >
                  Create free account
                </Link>
                <Link
                  href="/sign-in"
                  className="inline-flex items-center justify-center rounded-xl border border-white/30 bg-white/10 px-8 py-3.5 text-base font-semibold text-white backdrop-blur transition hover:bg-white/20"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────────── */}
      <section id="faq" className="pb-24">
        <div className="mx-auto max-w-2xl px-6">
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-widest text-violet-400">FAQ</p>
            <h2 className="mt-3 text-3xl font-bold text-white">Common questions</h2>
          </div>
          <div className="mt-10 space-y-3">
            {[
              {
                q: "Is this meant to replace my team?",
                a: "No. Orchest helps teams move faster on repetitive work — Q&A, summaries, and small reviewable changes. Your people stay in control and make all the important decisions.",
              },
              {
                q: "How do you keep things safe?",
                a: "Start with read-only workflows. When you enable write actions, Orchest keeps a human in the loop — every change goes through approval before it lands. Full audit trail included.",
              },
              {
                q: "What's the fastest way to see value?",
                a: "Connect Slack and one knowledge source (docs or a repo), then ask the agent to answer a common question. Most teams get a useful answer within minutes of setup.",
              },
              {
                q: "Which LLM models are supported?",
                a: "Orchest runs on multiple GPT-5 tier models. You can assign a different model to each agent, so you can tune performance vs. cost per workflow.",
              },
              {
                q: "Do I need to supply my own API keys?",
                a: "No. Orchest runs on our own API keys. You're billed based on token usage, similar to Cursor — a simple, transparent credit system with no surprises.",
              },
            ].map(({ q, a }) => (
              <details
                key={q}
                className="group rounded-2xl border border-zinc-800 bg-zinc-900 p-5 transition open:border-zinc-700"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-white">
                  {q}
                  <span className="shrink-0 text-zinc-500 transition group-open:rotate-45">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                    </svg>
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-6 text-zinc-400">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-zinc-800 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 sm:flex-row sm:justify-between">
          <Logo iconClassName="h-6 w-6" textClassName="text-sm" />
          <p className="text-sm text-zinc-500">
            © {new Date().getFullYear()} Orchest HQ. All rights reserved.
          </p>
          <div className="flex gap-6 text-sm text-zinc-500">
            <Link href="/sign-in" className="transition hover:text-white">Sign in</Link>
            <Link href="/sign-up" className="transition hover:text-white">Get started</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
