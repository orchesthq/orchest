-- Canonical model catalog for provider/model-group/model-specific mapping.
-- Used for UI filters and future agent->model selection.

create table if not exists llm_model_catalog (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model_group text not null,
  model_specific text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (provider, model_specific)
);

create index if not exists llm_model_catalog_provider_group_idx
  on llm_model_catalog (provider, model_group)
  where active = true;

insert into llm_model_catalog (provider, model_group, model_specific, active)
values
  ('openai_compatible', 'gpt-5.3', 'gpt-5.3-chat-latest', true),
  ('openai_compatible', 'gpt-5.3', 'gpt-5.3-codex', true),
  ('openai_compatible', 'gpt-5.2', 'gpt-5.2', true),
  ('openai_compatible', 'gpt-5.2', 'gpt-5.2-chat-latest', true),
  ('openai_compatible', 'gpt-5.2', 'gpt-5.2-codex', true),
  ('openai_compatible', 'gpt-5.1', 'gpt-5.1', true),
  ('openai_compatible', 'gpt-5.1', 'gpt-5.1-chat-latest', true),
  ('openai_compatible', 'gpt-5.1', 'gpt-5.1-codex-max', true),
  ('openai_compatible', 'gpt-5.1', 'gpt-5.1-codex', true),
  ('openai_compatible', 'gpt-5-mini', 'gpt-5-mini', true),
  ('openai_compatible', 'gpt-5-nano', 'gpt-5-nano', true),
  ('openai_compatible', 'gpt-5', 'gpt-5', true),
  ('openai_compatible', 'gpt-5', 'gpt-5-chat-latest', true),
  ('openai_compatible', 'gpt-5', 'gpt-5-codex', true)
on conflict (provider, model_specific) do update set
  model_group = excluded.model_group,
  active = excluded.active;
