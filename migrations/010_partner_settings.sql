-- Partner / integration settings (DB-backed env replacement)
-- Stores configuration for external partners like Slack, OpenAI, GitHub.
-- - `partner`: provider name (e.g. 'slack', 'openai', 'github')
-- - `key`: instance key (e.g. Slack bot key 'ava', or 'default')
-- - `settings`: JSON blob (shape validated in app code)

create table if not exists partner_settings (
  id uuid primary key default gen_random_uuid(),
  partner text not null,
  key text not null default 'default',
  settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner, key)
);

create index if not exists partner_settings_partner_idx on partner_settings(partner);

drop trigger if exists partner_settings_set_updated_at on partner_settings;
create trigger partner_settings_set_updated_at
before update on partner_settings
for each row execute function set_updated_at();

