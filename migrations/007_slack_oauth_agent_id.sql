-- Add agent_id to OAuth state so we can redirect to agent page and auto-link after install.
alter table slack_oauth_states
  add column if not exists agent_id uuid references agents(id) on delete cascade;
