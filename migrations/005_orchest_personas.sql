-- Orchest personas (product-level identities)
-- Adds a stable persona key to agents so names can be fixed while role/personality are configurable.

alter table agents
  add column if not exists persona_key text;

-- Only one hired agent per persona per client.
create unique index if not exists agents_client_id_persona_key_uq
  on agents(client_id, persona_key)
  where persona_key is not null;

