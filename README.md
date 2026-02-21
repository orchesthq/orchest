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
   - `migrations/003_slack_integration.sql`

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

## Slack integration (single app, many personas)

This MVP uses **one Slack app per workspace** and supports **multiple agent personas** (Ava, Ben, etc.) behind the scenes.

### 1) Create a Slack App

- Create a Slack app in your workspace (from `api.slack.com/apps`).
- Enable **OAuth & Permissions** and set the redirect URL:
  - `https://<your-fly-app>.fly.dev/integrations/slack/callback`
- Add **Bot Token Scopes**:
  - `chat:write`
  - `chat:write.customize`
  - `im:write`
  - `app_mentions:read`
  - `channels:read`, `groups:read`, `im:read`, `mpim:read`

### 2) Configure Event Subscriptions

- Enable **Event Subscriptions**
- Set Request URL:
  - `https://<your-fly-app>.fly.dev/integrations/slack/events`
- Subscribe to bot events:
  - `app_mention`
  - `message.im`

### 3) Set API env vars (Fly secrets)

Set these on your Fly API app:
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_SIGNING_SECRET`
- `SLACK_REDIRECT_URI` (must match the redirect URL configured in Slack)
- `DASHBOARD_BASE_URL` (your Vercel dashboard URL)

### 4) Connect + enable from dashboard

- Go to `Dashboard → Slack integration` (`/app/integrations/slack`) and click **Connect Slack**
- Open an Agent and click **Enable in Slack**
  - Orchest will open a DM with the installing Slack user and send the agent onboarding message.

## Design notes

- **Client isolation**: all DB reads/writes are scoped by client ownership (directly via `client_id`, or via joins from `agent_id`).
- **Dashboard auth**: NextAuth Credentials backed by `users` + `client_memberships`.
- **Dashboard → API**: the dashboard calls the API with `x-internal-secret` + `x-client-id`.
- **LLM integration**: uses an OpenAI-compatible endpoint. If `OPENAI_API_KEY` is absent, planning + summarization return mocked deterministic output so the system remains runnable.
- **GitHub tools**: scaffolded tool definitions only (logs intended actions; no real API calls yet).

