-- Orchest initial schema (Supabase-compatible)
-- - Uses pgcrypto for UUID generation (gen_random_uuid)
-- - Uses pgvector for embeddings (optional column on agent_memories)

create extension if not exists pgcrypto;
create extension if not exists vector;

-- Tenants
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Digital employees
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  role text not null,
  system_prompt text not null,
  created_at timestamptz not null default now()
);

create index if not exists agents_client_id_idx on agents(client_id);

-- Work assigned to agents
do $$ begin
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type task_status as enum ('pending', 'running', 'completed', 'failed');
  end if;
end $$;

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  status task_status not null default 'pending',
  input text not null,
  output text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_agent_id_idx on tasks(agent_id);
create index if not exists tasks_status_idx on tasks(status);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tasks_set_updated_at on tasks;
create trigger tasks_set_updated_at
before update on tasks
for each row execute function set_updated_at();

-- Memory
do $$ begin
  if not exists (select 1 from pg_type where typname = 'memory_type') then
    create type memory_type as enum ('profile', 'episodic', 'semantic');
  end if;
end $$;

create table if not exists agent_memories (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  memory_type memory_type not null,
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists agent_memories_agent_id_idx on agent_memories(agent_id);
-- Optional vector index (enable when you start doing vector search)
-- create index if not exists agent_memories_embedding_idx
--   on agent_memories using ivfflat (embedding vector_cosine_ops) with (lists = 100);

