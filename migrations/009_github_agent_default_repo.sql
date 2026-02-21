-- Add default_repo so each agent knows which repo to act on.
alter table github_agent_connections
  add column if not exists default_repo text;
