-- USD billing foundations.
-- - Adds pricing snapshots to token usage events.
-- - Adds model/provider rate card table.
-- - Adds per-client billing profile table.

alter table token_usage_events
  add column if not exists input_cost_usd_micros bigint,
  add column if not exists output_cost_usd_micros bigint,
  add column if not exists total_cost_usd_micros bigint,
  add column if not exists markup_multiplier_snapshot numeric(10,4),
  add column if not exists billable_usd_micros bigint,
  add column if not exists pricing_version text;

alter table token_usage_events
  add constraint token_usage_events_input_cost_usd_micros_non_negative
    check (input_cost_usd_micros is null or input_cost_usd_micros >= 0),
  add constraint token_usage_events_output_cost_usd_micros_non_negative
    check (output_cost_usd_micros is null or output_cost_usd_micros >= 0),
  add constraint token_usage_events_total_cost_usd_micros_non_negative
    check (total_cost_usd_micros is null or total_cost_usd_micros >= 0),
  add constraint token_usage_events_billable_usd_micros_non_negative
    check (billable_usd_micros is null or billable_usd_micros >= 0),
  add constraint token_usage_events_markup_multiplier_snapshot_positive
    check (markup_multiplier_snapshot is null or markup_multiplier_snapshot > 0);

create index if not exists token_usage_events_client_occurred_at_billable_idx
  on token_usage_events (client_id, occurred_at desc, billable_usd_micros);

create table if not exists llm_pricing_rates (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  operation text not null,
  token_type text not null check (token_type in ('input', 'output')),
  -- Price expressed in USD micros per 1M tokens.
  usd_per_1m_tokens bigint not null check (usd_per_1m_tokens >= 0),
  pricing_version text not null default 'v1',
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

create index if not exists llm_pricing_rates_lookup_idx
  on llm_pricing_rates (provider, model, operation, token_type, active, effective_from desc);

create unique index if not exists llm_pricing_rates_unique_window_idx
  on llm_pricing_rates (provider, model, operation, token_type, pricing_version, effective_from);

drop trigger if exists llm_pricing_rates_set_updated_at on llm_pricing_rates;
create trigger llm_pricing_rates_set_updated_at
before update on llm_pricing_rates
for each row execute function set_updated_at();

create table if not exists client_billing_profiles (
  client_id uuid primary key references clients(id) on delete cascade,
  markup_multiplier numeric(10,4) not null default 1.0000 check (markup_multiplier > 0),
  free_monthly_usd_micros bigint not null default 0 check (free_monthly_usd_micros >= 0),
  billing_mode text not null default 'usd_credits' check (billing_mode in ('usd_credits')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists client_billing_profiles_set_updated_at on client_billing_profiles;
create trigger client_billing_profiles_set_updated_at
before update on client_billing_profiles
for each row execute function set_updated_at();

insert into client_billing_profiles (client_id)
select c.id
from clients c
on conflict (client_id) do nothing;
