-- Token usage tracking (per LLM call)
-- One row per provider/model call so we can aggregate per org (client) and per agent.

create table if not exists token_usage_events (
  id bigserial primary key,
  client_id bigint not null references clients(id) on delete cascade,
  agent_id bigint references agents(id) on delete set null,
  provider text not null,
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  request_id text,
  created_at timestamptz not null default now()
);

create index if not exists token_usage_events_client_created_at_idx
  on token_usage_events (client_id, created_at desc);

create index if not exists token_usage_events_client_agent_created_at_idx
  on token_usage_events (client_id, agent_id, created_at desc);
