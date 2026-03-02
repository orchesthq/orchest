-- Company Knowledge Base (KB) using pgvector for RAG.
-- MVP: index GitHub repos (text + code) into chunk embeddings per client.

-- Enable pgvector (Supabase supports this).
create extension if not exists vector;

create table if not exists kb_sources (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  provider text not null check (provider in ('github')),
  repo_full_name text not null,
  ref text not null default 'main',
  last_synced_sha text,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, provider, repo_full_name, ref)
);

create index if not exists kb_sources_client_id_idx on kb_sources(client_id);
create index if not exists kb_sources_repo_idx on kb_sources(client_id, provider, repo_full_name);

create table if not exists kb_chunks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  source_id uuid not null references kb_sources(id) on delete cascade,
  path text not null,
  start_line int not null,
  end_line int not null,
  content text not null,
  content_hash text not null,
  embedding vector(1536),
  token_count int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, path, start_line, end_line)
);

create index if not exists kb_chunks_client_id_idx on kb_chunks(client_id);
create index if not exists kb_chunks_source_path_idx on kb_chunks(source_id, path);

-- Optional: add a vector index once you have enough chunks to benefit.
-- (Keeping MVP simple; sequential scan is fine for small KBs.)
-- create index if not exists kb_chunks_embedding_idx on kb_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

