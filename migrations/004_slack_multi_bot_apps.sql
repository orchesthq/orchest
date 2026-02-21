-- Slack multi-bot upgrade
-- Supports multiple Slack apps (bots) installed into the same workspace.
-- We identify which app received an event via `api_app_id` (from Slack event payload),
-- and verify signatures against any configured signing secret.

-- slack_oauth_states: track which bot the OAuth flow belongs to.
alter table slack_oauth_states
  add column if not exists bot_key text not null default 'orchest';

-- slack_installations: allow multiple installs per workspace (team) by bot_key.
alter table slack_installations
  add column if not exists bot_key text not null default 'orchest';

alter table slack_installations
  add column if not exists api_app_id text;

-- Drop old uniqueness constraints (single-app assumptions)
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'slack_installations_team_id_key'
  ) then
    alter table slack_installations drop constraint slack_installations_team_id_key;
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'slack_installations_client_id_team_id_key'
  ) then
    alter table slack_installations drop constraint slack_installations_client_id_team_id_key;
  end if;
end $$;

-- New uniqueness constraints for multi-bot
create unique index if not exists slack_installations_team_id_bot_key_uq
  on slack_installations(team_id, bot_key);

create unique index if not exists slack_installations_client_id_team_id_bot_key_uq
  on slack_installations(client_id, team_id, bot_key);

-- slack_agent_links: track which bot identity the agent is enabled under.
alter table slack_agent_links
  add column if not exists bot_key text not null default 'orchest';

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'slack_agent_links_team_id_agent_id_key'
  ) then
    alter table slack_agent_links drop constraint slack_agent_links_team_id_agent_id_key;
  end if;
end $$;

create unique index if not exists slack_agent_links_team_id_agent_id_bot_key_uq
  on slack_agent_links(team_id, agent_id, bot_key);

-- Routing DMs back to the right agent+bot.
create index if not exists slack_agent_links_team_id_bot_key_dm_channel_id_idx
  on slack_agent_links(team_id, bot_key, dm_channel_id);

