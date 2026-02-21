-- Slack integration (single app, many personas)
-- Stores workspace installation per client and per-agent Slack presence (e.g. DM channel).

create table if not exists slack_installations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  team_id text not null,
  team_name text,
  enterprise_id text,
  bot_user_id text not null,
  bot_access_token text not null,
  installed_by_user_id text not null,
  installed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (client_id, team_id),
  unique (team_id)
);

create index if not exists slack_installations_client_id_idx on slack_installations(client_id);

-- OAuth state storage to prevent CSRF and bind Slack installs to a specific client.
create table if not exists slack_oauth_states (
  state text primary key,
  client_id uuid not null references clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists slack_oauth_states_expires_at_idx on slack_oauth_states(expires_at);

-- Slack presence per agent (for routing DMs and posting as a persona).
create table if not exists slack_agent_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  team_id text not null,
  dm_channel_id text,
  display_name text not null,
  icon_url text,
  created_at timestamptz not null default now(),
  unique (team_id, agent_id)
);

create index if not exists slack_agent_links_client_id_idx on slack_agent_links(client_id);
create index if not exists slack_agent_links_team_id_idx on slack_agent_links(team_id);
create index if not exists slack_agent_links_dm_channel_id_idx on slack_agent_links(dm_channel_id);

