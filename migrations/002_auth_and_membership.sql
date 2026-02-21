-- Auth + client membership (MVP)
-- This enables a login-protected dashboard with per-client data isolation.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- A user can belong to one or more clients. For MVP, we’ll treat the earliest
-- membership as the “primary” client in the dashboard.
create table if not exists client_memberships (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  unique (client_id, user_id)
);

create index if not exists client_memberships_user_id_idx on client_memberships(user_id);
create index if not exists client_memberships_client_id_idx on client_memberships(client_id);

