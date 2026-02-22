-- Allow multiple GitHub repo links per agent.
-- We model each allowed repo as a row in github_agent_connections, keyed by (agent_id, default_repo).
-- Special repo value '*' means "all repos" (still requires repo arg when calling tools).

-- Backfill null repos (from older versions) to '*'.
update github_agent_connections
set default_repo = '*'
where default_repo is null;

-- Drop old uniqueness (one connection per agent).
alter table github_agent_connections
  drop constraint if exists github_agent_connections_agent_id_key;

-- default_repo is now required (repo full_name or '*').
alter table github_agent_connections
  alter column default_repo set not null;

-- New uniqueness: one row per agent per repo selector.
alter table github_agent_connections
  add constraint github_agent_connections_agent_repo_key unique (agent_id, default_repo);

create index if not exists github_agent_connections_agent_repo_idx
  on github_agent_connections(agent_id, default_repo);

