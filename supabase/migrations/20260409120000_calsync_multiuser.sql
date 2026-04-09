-- CalSync multi-user: one row per human "user", many Google identities, JSON store per user.

create table if not exists public.calsync_users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.calsync_identities (
  identity_key text primary key,
  user_id uuid not null references public.calsync_users (id) on delete cascade
);

create index if not exists calsync_identities_user_id_idx
  on public.calsync_identities (user_id);

create table if not exists public.calsync_stores (
  user_id uuid primary key references public.calsync_users (id) on delete cascade,
  store jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.calsync_watch_channels (
  channel_id text primary key,
  user_id uuid not null references public.calsync_users (id) on delete cascade
);

create index if not exists calsync_watch_channels_user_id_idx
  on public.calsync_watch_channels (user_id);

-- Server uses service role only; optional hardening for direct client access:
alter table public.calsync_users enable row level security;
alter table public.calsync_identities enable row level security;
alter table public.calsync_stores enable row level security;
alter table public.calsync_watch_channels enable row level security;
