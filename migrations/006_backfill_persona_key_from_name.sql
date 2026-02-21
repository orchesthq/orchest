-- Backfill persona_key for legacy agents created before personas existed.
-- Strategy: for each client, if multiple agents share the same persona name,
-- only the earliest created agent gets the persona_key (prevents unique index conflicts).

with ranked as (
  select id, client_id, row_number() over (partition by client_id order by created_at asc) as rn
  from agents
  where persona_key is null and lower(name) = 'ava'
)
update agents
set persona_key = 'ava'
from ranked r
where agents.id = r.id and r.rn = 1;

with ranked as (
  select id, client_id, row_number() over (partition by client_id order by created_at asc) as rn
  from agents
  where persona_key is null and lower(name) = 'ben'
)
update agents
set persona_key = 'ben'
from ranked r
where agents.id = r.id and r.rn = 1;

with ranked as (
  select id, client_id, row_number() over (partition by client_id order by created_at asc) as rn
  from agents
  where persona_key is null and lower(name) = 'priya'
)
update agents
set persona_key = 'priya'
from ranked r
where agents.id = r.id and r.rn = 1;

with ranked as (
  select id, client_id, row_number() over (partition by client_id order by created_at asc) as rn
  from agents
  where persona_key is null and lower(name) = 'sofia'
)
update agents
set persona_key = 'sofia'
from ranked r
where agents.id = r.id and r.rn = 1;

with ranked as (
  select id, client_id, row_number() over (partition by client_id order by created_at asc) as rn
  from agents
  where persona_key is null and lower(name) = 'amira'
)
update agents
set persona_key = 'amira'
from ranked r
where agents.id = r.id and r.rn = 1;

