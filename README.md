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
   - `migrations/004_slack_multi_bot_apps.sql`
   - `migrations/005_orchest_personas.sql`
   - `migrations/006_backfill_persona_key_from_name.sql`

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

## Slack integration (5 apps / 5 bots)

This MVP uses **multiple Slack apps per workspace** so users can naturally interact with bots like **@Ava** or **@Priya** (instead of `@Orchest`).
Each bot is a separate Slack app, but they all point to the **same Orchest API endpoints**.

### 1) Create 5 Slack Apps (Ava, Ben, Priya, Sofia, Amira)

- Create one Slack app per bot in your workspace (from `api.slack.com/apps`).
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

### 3) Enable Direct Messages (required for DMs)

Users must be able to send messages to your bot. In each Slack app:

1. Go to **App Home** (sidebar) → **Allow users to send Slash commands and messages from the messages tab** → enable.
2. Or edit the **App Manifest** and add:

```yaml
features:
  app_home:
    home_tab_enabled: false
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
```

Without this, users see "Sending messages to this app has been turned off" and cannot DM the bot.

### 4) Set API env vars (Fly secrets)

Set these on your Fly API app:
- `SLACK_BOT_KEYS` (comma-separated: `ava,ben,priya,sofia,amira`)
- `SLACK_<BOT>_CLIENT_ID`
- `SLACK_<BOT>_CLIENT_SECRET`
- `SLACK_<BOT>_SIGNING_SECRET`
- `SLACK_REDIRECT_URI` (must match the redirect URL configured in Slack)
- `DASHBOARD_BASE_URL` (your Vercel dashboard URL)

### 5) Connect + enable from dashboard

- Go to `Dashboard → Slack integration` (`/app/integrations/slack`) and install each bot you want (Ava, Priya, ...)
- Open an Agent and click **Enable in Slack** under the chosen bot identity
  - Orchest will open a DM with the installing Slack user and send the agent onboarding message.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for plans around:
- Company context (RAG, document ingestion)
- Tooling: GitHub, Jira, Confluence
- Dogfooding Orchest with its own AI agents

## Design notes

- **Client isolation**: all DB reads/writes are scoped by client ownership (directly via `client_id`, or via joins from `agent_id`).
- **Dashboard auth**: NextAuth Credentials backed by `users` + `client_memberships`.
- **Dashboard → API**: the dashboard calls the API with `x-internal-secret` + `x-client-id`.
- **LLM integration**: uses an OpenAI-compatible endpoint. If `OPENAI_API_KEY` is absent, planning + summarization return mocked deterministic output so the system remains runnable.
- **GitHub tools**: scaffolded tool definitions only (logs intended actions; no real API calls yet).

