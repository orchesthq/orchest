# GitHub Integration Design

A design for giving Orchest agents access to GitHub from the dashboard. **Each agent has its own GitHub connection** and appears as a separate "user" in GitHub via commit author (name + email). Acme's Ava and Acme's Ben show different identities in git history.

---

## Per-agent model

- **Client** connects GitHub once (install Orchest GitHub App on their org)
- **Each agent** links to that installation with its own `commit_author_name` and `commit_author_email`
- Commits from Ava show as "Ava (Acme) <ava@agents.orchest.io>", Ben as "Ben (Acme) <ben@agents.orchest.io>"
- Tables: `github_installations` (client-level), `github_agent_connections` (per-agent)

---

## Approach: GitHub App vs OAuth App

| | OAuth App | GitHub App |
|---|-----------|------------|
| **Repo selection** | User authorizes all repos they can access | User picks specific repos (or "all") at install time |
| **Token model** | User token (acts as user) | Installation token (acts as app, scoped to installed repos) |
| **Revocation** | User revokes in GitHub settings | Org/repo admin uninstalls app |
| **Granularity** | Coarse scopes (`repo`, `public_repo`) | Fine-grained (Contents, PRs, etc.) |

**Recommendation: GitHub App.** Better fit for “which repos can our agents touch” and cleaner permission model.

---

## Access levels (per repo or globally)

Three levels clients can choose from:

| Level | Behavior | Use case |
|-------|----------|----------|
| **Read-only** | Agents can read files, list branches, search. No commits, no PRs. | Codebase Q&A, analysis, suggestions |
| **PR-only** (recommended) | Agents create branch → commit → push → open PR. Human reviews and merges. | Safe dogfooding, production |
| **Direct push** | Agents can push to non-protected branches without PR. | Trusted agents, automation branches |

Default: **PR-only**.

---

## Dashboard flow

### 1. Integrations page

Add **Integrations** to the nav (or a Settings/Integrations section). On that page:

- **GitHub** – Connected / Not connected
- If not connected: **Connect GitHub** button

### 2. Connect GitHub

- User clicks **Connect GitHub**
- Redirect to GitHub App installation URL (with `client_id` or state to associate to our client)
- GitHub shows: “Orchest wants to access your repositories”
- User selects: **All repositories** or **Only select repositories** (checkboxes)
- User approves
- GitHub redirects to our callback with `installation_id`
- We exchange for an installation access token, store it

### 3. Post-connect: configure access

After connecting, show:

- **Repositories you granted:** list (from install response or API)
- **Access level** (dropdown):
  - **Read-only** – agents can read, not change
  - **PR-only** – agents open PRs, you merge (recommended)
  - **Direct push** – agents can push to non-protected branches
- **Default branch** (optional) – e.g. `main`, used as base for new branches
- **Save**

If they chose “only select repositories,” we already have the list. If “all,” we can list via API and let them optionally narrow it in our UI later (optional enhancement).

---

## Database schema

### `github_installations`

```sql
create table github_installations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  installation_id bigint not null unique,   -- GitHub's installation ID
  owner_login text not null,                 -- e.g. "jbatt" or "orchest-ai"
  access_token text not null,               -- installation token (encrypt in prod)
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index github_installations_client_id_idx on github_installations(client_id);
create unique index github_installations_installation_id_idx on github_installations(installation_id);
```

### `github_repo_access`

Per-repo or per-installation access level.

```sql
create table github_repo_access (
  id uuid primary key default gen_random_uuid(),
  github_installation_id uuid not null references github_installations(id) on delete cascade,
  repo_full_name text not null,              -- "owner/repo"
  access_level text not null check (access_level in ('read', 'pr_only', 'direct_push')),
  default_branch text not null default 'main',
  created_at timestamptz not null default now(),
  unique (github_installation_id, repo_full_name)
);

create index github_repo_access_installation_idx on github_repo_access(github_installation_id);
```

**Simplification:** If “all repos” is chosen, we can store a single row with `repo_full_name = '*'` and `access_level = 'pr_only'`, and treat `*` as “any repo in this installation.” Or we can backfill rows when the agent first touches a repo.

---

## Agent loop integration

1. **Load GitHub context** – When a task runs, check if the client has a `github_installation` and which repos/access levels apply.
2. **Pass to planner** – Include in the prompt: “You have access to: repo X (pr_only), repo Y (read).”
3. **Tool execution** – When `simulateStep` or the tool router sees `create_branch`, `commit_changes`, `open_pull_request`:
   - Resolve `client_id` from task context
   - Load `github_installations` + `github_repo_access` for that client
   - If repo is allowed and access level allows the action: call real GitHub API
   - If not allowed: return “Repo X is not connected” or “Repo X is read-only”

### Access checks

| Tool | read | pr_only | direct_push |
|------|------|---------|-------------|
| `read_file`, `list_branches` | ✅ | ✅ | ✅ |
| `create_branch` | ❌ | ✅ | ✅ |
| `commit_changes` | ❌ | ✅ | ✅ |
| `open_pull_request` | ❌ | ✅ | ✅ |
| Push to branch (no PR) | ❌ | ❌ | ✅ |

---

## GitHub App registration

1. **github.com** → Settings → Developer settings → GitHub Apps → New GitHub App
2. **Name:** Orchest
3. **Homepage URL:** Dashboard URL
4. **Callback URL:** `https://<api>/.well-known/github/installation/callback` or similar
5. **Setup URL (post-install):** `https://<dashboard>/app/integrations/github/callback` to land on our “configure access” page
6. **Permissions:**
   - Repository: Contents (Read and write)
   - Repository: Pull requests (Read and write)
   - Repository: Metadata (Read)
7. **Subscribe to events:** (optional) `push`, `pull_request` for future webhooks
8. **Where can it be installed:** Any account or only this account (for dogfooding)

---

## Implementation phases

### Phase 1: Connect & store (MVP)

- [ ] Create GitHub App, get App ID + private key
- [ ] Migration: `github_installations`, `github_repo_access`
- [ ] API: `GET /internal/github/install-url?clientId=...` → redirect URL
- [ ] API: `GET /integrations/github/callback?installation_id=...` (public) → exchange for token, store, redirect to dashboard
- [ ] Dashboard: Integrations page with “Connect GitHub”
- [ ] Dashboard: After connect, show status and (optional) repo list

### Phase 2: Wire real GitHub tools

- [ ] `githubTools.ts`: use `getInstallationToken(clientId)` instead of env `GITHUB_TOKEN`
- [ ] Add repo + access check before each tool call
- [ ] Agent loop: pass available repos into planner

### Phase 3: Granular repo + access config

- [ ] Dashboard: after connect, fetch installed repos via API
- [ ] UI: select repos + set access level per repo (or global default)
- [ ] Persist in `github_repo_access`

### Phase 4: Token refresh

- [ ] Installation tokens expire (1 hour). Use GitHub’s JWTs to request new ones on demand, or refresh periodically.

---

## Quick start for dogfooding

To dogfood immediately with minimal UI:

1. **Manual setup:** Store `GITHUB_TOKEN` in Fly secrets (personal or fine-grained PAT).
2. **Single repo:** Env `GITHUB_REPO=jbatt/Orchest` (or your org/repo).
3. **Wire `githubTools.ts`** to use `GITHUB_TOKEN` and real GitHub API.
4. **Always PR-only** in code: never push to `main`, always open PR.

Then iterate toward the full dashboard flow and GitHub App when ready.
