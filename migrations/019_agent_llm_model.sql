-- Per-agent LLM model assignment (provider + model_specific).
-- This replaces global/default-only model behavior for agent execution.

alter table agents
  add column if not exists llm_provider text not null default 'openai_compatible',
  add column if not exists llm_model text not null default 'gpt-5.2';

-- Keep existing rows valid and future rows constrained to known catalog entries.
do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'agents_llm_provider_model_fk'
  ) then
    alter table agents
      add constraint agents_llm_provider_model_fk
        foreign key (llm_provider, llm_model)
        references llm_model_catalog(provider, model_specific)
        on update cascade
        on delete restrict;
  end if;
end $$;

create index if not exists agents_client_llm_model_idx
  on agents (client_id, llm_provider, llm_model);
