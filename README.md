# Orchest (MVP)

AI Workforce Orchestrator: onboard AI agents as “digital employees”, assign them work, and persist identity + memory with client isolation.

## Requirements

- Node.js 18+ (Node 20+ recommended)
- Postgres (Supabase-compatible). For embeddings, enable `pgvector`.

## Setup

1. Install deps:

```bash
npm install
```

2. Create a repo-root `.env` from `.env.example`.

3. Apply migrations to your Postgres database (Supabase SQL editor is fine):
   - `migrations/001_init.sql`
   - `migrations/002_auth_and_membership.sql`

4. Create dashboard env:
   - Copy `apps/dashboard/.env.local.example` → `apps/dashboard/.env.local`
   - Make sure `DATABASE_URL` matches your repo-root `.env`
   - `INTERNAL_SERVICE_SECRET` must match between dashboard + API

5. Run dev:

```bash
npm run dev
```

This starts:
- API: `http://localhost:3000`
- Dashboard: `http://localhost:3001`

## End-to-end smoke test (dashboard)

1. Open `http://localhost:3001`
2. Click **Create account**
3. Enter company name + email/password
4. You should land on `/app`, then **View agents**
5. Create a new agent and edit its name/personality

## Hosting (recommended)

### Dashboard (Vercel)

1. Create a Vercel account and import this repo.
2. Configure the project root as `apps/dashboard`.
3. Set environment variables in Vercel:
   - `NEXTAUTH_URL` (your Vercel dashboard URL)
   - `NEXTAUTH_SECRET`
   - `DATABASE_URL` (same Supabase Postgres URL)
   - `API_BASE_URL` (your Fly API URL, e.g. `https://<app>.fly.dev`)
   - `INTERNAL_SERVICE_SECRET` (must match the API’s value)
4. Deploy.

### API (Fly.io)

1. Create a Fly.io account and install `flyctl`.
2. From `apps/api`, run:
   - `fly launch` (Fly will detect `Dockerfile`)
3. Set secrets:
   - `fly secrets set DATABASE_URL=... INTERNAL_SERVICE_SECRET=...`
4. Deploy:
   - `fly deploy`

## Design notes

- **Client isolation**: all DB reads/writes are scoped by client ownership (directly via `client_id`, or via joins from `agent_id`).
- **Dashboard auth**: NextAuth Credentials backed by `users` + `client_memberships`.
- **Dashboard → API**: the dashboard calls the API with `x-internal-secret` + `x-client-id`.
- **LLM integration**: uses an OpenAI-compatible endpoint. If `OPENAI_API_KEY` is absent, planning + summarization return mocked deterministic output so the system remains runnable.
- **GitHub tools**: scaffolded tool definitions only (logs intended actions; no real API calls yet).

