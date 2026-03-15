-- Token accounting foundations.
--
-- 1) token_usage_events
--    Immutable per-provider call usage rows (chat completions, embeddings, etc.)
--    for analytics and audit.
--
-- 2) token_ledger_entries
--    Client token balance movements (free grants, topups, subscription allocations,
--    usage debits, manual adjustments) for billing/accounting.

create table if not exists token_usage_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  provider text not null,
  model text not null,
  operation text not null default 'chat.completion',
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  cached_prompt_tokens integer not null default 0 check (cached_prompt_tokens >= 0),
  reasoning_tokens integer not null default 0 check (reasoning_tokens >= 0),
  total_tokens integer generated always as (prompt_tokens + completion_tokens) stored,
  provider_request_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists token_usage_events_provider_request_uniq
  on token_usage_events (provider, provider_request_id)
  where provider_request_id is not null;

create index if not exists token_usage_events_client_occurred_at_idx
  on token_usage_events (client_id, occurred_at desc);

create index if not exists token_usage_events_client_agent_occurred_at_idx
  on token_usage_events (client_id, agent_id, occurred_at desc);

create index if not exists token_usage_events_client_model_occurred_at_idx
  on token_usage_events (client_id, model, occurred_at desc);

create index if not exists token_usage_events_task_idx
  on token_usage_events (task_id)
  where task_id is not null;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'token_ledger_entry_type') then
    create type token_ledger_entry_type as enum (
      'grant',
      'topup',
      'subscription_allocation',
      'usage_debit',
      'adjustment'
    );
  end if;
end $$;

create table if not exists token_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  entry_type token_ledger_entry_type not null,
  -- Positive = credit, negative = debit.
  tokens integer not null check (tokens <> 0),
  reference_type text,
  reference_id uuid,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists token_ledger_entries_reference_uniq
  on token_ledger_entries (reference_type, reference_id)
  where reference_type is not null and reference_id is not null;

create index if not exists token_ledger_entries_client_created_at_idx
  on token_ledger_entries (client_id, created_at desc);

create index if not exists token_ledger_entries_client_entry_type_created_at_idx
  on token_ledger_entries (client_id, entry_type, created_at desc);

create or replace view client_token_balances as
select
  client_id,
  coalesce(sum(tokens), 0)::bigint as token_balance
from token_ledger_entries
group by client_id;