-- User verification + client invite foundations.

alter table users
  add column if not exists email_verified_at timestamptz;

-- Keep existing accounts usable: treat current users as already verified.
update users
set email_verified_at = created_at
where email_verified_at is null;

create table if not exists user_email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  purpose text not null check (purpose in ('signup', 'invite')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_email_verification_tokens_user_idx
  on user_email_verification_tokens(user_id, created_at desc);

create table if not exists client_user_invites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  email text not null,
  invited_by_user_id uuid references users(id) on delete set null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists client_user_invites_client_idx
  on client_user_invites(client_id, created_at desc);
