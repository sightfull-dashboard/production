-- Run these in your Supabase SQL editor before enabling:
-- SESSION_STORE_DRIVER=supabase
-- AUTH_RATE_LIMIT_STORE_DRIVER=supabase

create table if not exists public.app_sessions (
  sid text primary key,
  sess text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_sessions_expires_at on public.app_sessions (expires_at);

create table if not exists public.app_rate_limits (
  key text primary key,
  count integer not null default 0,
  reset_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_rate_limits_reset_at on public.app_rate_limits (reset_at);
