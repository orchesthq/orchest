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

2. Create `apps/api/.env` from `apps/api/.env.example`.

3. Apply migrations to your Postgres database (Supabase SQL editor is fine):
   - `migrations/001_init.sql`
   - `migrations/002_auth_and_membership.sql`
   - `migrations/003_slack_integration.sql`
   - `migrations/004_slack_multi_bot_apps.sql`
   - `migrations/005_orchest_personas.sql`
   - `migrations/006_backfill_persona_key_from_name.sql`
   - `migrations/007_slack_oauth_agent_id.sql`
   - `migrations/008_github_integration.sql`
   - `migrations/009_github_agent_default_repo.sql`
   - `migrations/010_partner_settings.sql`
   - `migrations/011_github_agent_multi_repo.sql`
   - `migrations/012_company_kb.sql`
   - `migrations/013_kb_chunk_metadata.sql`

4. Create dashboard env:
   - Copy `apps/dashboard/.env.local.example` → `apps/dashboard/.env.local`
   - Make sure `DATABASE_URL` matches `apps/api/.env`
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
  - `channels:history`, `groups:history`, `im:history`, `mpim:history`
  - `files:read`
  - `canvases:write`

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
- `SLACK_REDIRECT_URI` (must match the redirect URL configured in Slack)
- `DASHBOARD_BASE_URL` (your Vercel dashboard URL)

Then store Slack app credentials in Postgres (`partner_settings`) instead of env vars:

```sql
-- One row per Slack bot app (Ava/Ben/...)
insert into partner_settings (partner, key, settings)
values (
  'slack',
  'ava',
  jsonb_build_object(
    'clientId', '<slack client id>',
    'clientSecret', '<slack client secret>',
    'signingSecret', '<slack signing secret>'
  )
)
on conflict (partner, key) do update set settings = excluded.settings, updated_at = now();
```

Optional defaults (used only for legacy Slack intake / testing):

```sql
insert into partner_settings (partner, key, settings)
values (
  'slack',
  'defaults',
  jsonb_build_object(
    'defaultClientName', 'Default Client',
    'defaultAgentName', 'AI Software Engineer'
  )
)
on conflict (partner, key) do update set settings = excluded.settings, updated_at = now();
```

### 5) Connect + enable from dashboard

- Go to `Dashboard → Slack integration` (`/app/integrations/slack`) and install each bot you want (Ava, Priya, ...)
- Open an Agent and click **Enable in Slack** under the chosen bot identity
  - Orchest will open a DM with the installing Slack user and send the agent onboarding message.

## GitHub integration (per-agent)

Each agent can be linked to GitHub with its own commit identity (e.g. "Ava (Acme)" vs "Ben (Acme)" in git history).

### 1) Create a GitHub App

1. Go to [GitHub → Settings → Developer settings → GitHub Apps → New GitHub App](https://github.com/settings/apps/new)
2. **Name:** Orchest
3. **Homepage URL:** your dashboard URL (e.g. `https://your-dashboard.vercel.app`)
4. **Setup URL (post-install redirect):** **Required** – `https://<your-dashboard-domain>/app/integrations/github/callback`  
   Without this, GitHub will not redirect users back after install.
5. **Permissions:** Repository → Contents (Read and write), Pull requests (Read and write), Metadata (Read)
6. Create the app, then under "About" note the **App ID** and **slug** (from the URL). Generate a **private key**.

### 2) Store GitHub App settings in Postgres

Store GitHub App configuration in Postgres (`partner_settings`). Recommended: use `$$...$$` so the PEM keeps real newlines.

```sql
insert into partner_settings (partner, key, settings)
values (
  'github',
  'default',
  jsonb_build_object(
    'appId', 123456,
    'appSlug', 'orchest-github',
    'webhookSecret', 'your-secret-configured-in-github',
    'privateKey', $$-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----$$
  )
)
on conflict (partner, key) do update set settings = excluded.settings, updated_at = now();
```

### 3) Connect from dashboard

- Open an Agent → **GitHub** section → **Go to GitHub integration** (if not yet connected)
- Install the app on your org/repos
- **Link to GitHub** – set commit author name/email for this agent

See [docs/GITHUB_INTEGRATION_DESIGN.md](./docs/GITHUB_INTEGRATION_DESIGN.md) for full design.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for plans around:
- Company context (RAG, document ingestion)
- Tooling: GitHub, Jira, Confluence
- Dogfooding Orchest with its own AI agents

## Design notes

- **Client isolation**: all DB reads/writes are scoped by client ownership (directly via `client_id`, or via joins from `agent_id`).
- **Dashboard auth**: NextAuth Credentials backed by `users` + `client_memberships`.
- **Dashboard → API**: the dashboard calls the API with `x-internal-secret` + `x-client-id`.
- **LLM integration**: uses an OpenAI-compatible endpoint. If OpenAI settings are not configured in `partner_settings`, planning + summarization return mocked deterministic output so the system remains runnable.
- **GitHub tools**: real GitHub App tools with safety guardrails (chunked reads + patch-based edits + pre-PR diff gate).
- **Agent engine**: selectable via `ORCHEST_AGENT_ENGINE` (see `apps/api/.env.example`).

### OpenAI settings (optional)

Store OpenAI-compatible settings in Postgres (`partner_settings`):

```sql
insert into partner_settings (partner, key, settings)
values (
  'openai',
  'default',
  jsonb_build_object(
    'apiKey', '<openai api key>',
    'baseUrl', 'https://api.openai.com/v1',
    'model', 'gpt-4o-mini'
  )
)
on conflict (partner, key) do update set settings = excluded.settings, updated_at = now();
```

