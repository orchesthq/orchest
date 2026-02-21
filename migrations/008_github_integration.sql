-- GitHub integration: per-client installation, per-agent connections with separate commit identities.
-- Each agent appears as a distinct "user" in GitHub (via commit author name/email).

-- Client-level: one GitHub App installation per client (from installing Orchest GitHub App).
create table if not exists github_installations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  installation_id bigint not null,
  owner_login text not null,
  access_token text not null,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id)
);

create index if not exists github_installations_client_id_idx on github_installations(client_id);

-- Per-agent: each agent links to a GitHub installation with its own commit identity.
-- Commits from Acme's Ava show as "Ava (Acme)" – separate from Acme's Ben.
create table if not exists github_agent_connections (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  github_installation_id uuid not null references github_installations(id) on delete cascade,
  commit_author_name text not null,
  commit_author_email text not null,
  access_level text not null check (access_level in ('read', 'pr_only', 'direct_push')) default 'pr_only',
  default_branch text not null default 'main',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id)
);

create index if not exists github_agent_connections_agent_id_idx on github_agent_connections(agent_id);
create index if not exists github_agent_connections_installation_idx on github_agent_connections(github_installation_id);

-- Which repos this agent can access (empty = all repos from installation).
create table if not exists github_agent_repos (
  id uuid primary key default gen_random_uuid(),
  github_agent_connection_id uuid not null references github_agent_connections(id) on delete cascade,
  repo_full_name text not null,
  created_at timestamptz not null default now(),
  unique (github_agent_connection_id, repo_full_name)
);

create index if not exists github_agent_repos_connection_idx on github_agent_repos(github_agent_connection_id);
