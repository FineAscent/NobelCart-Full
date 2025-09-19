-- 0004_active_sessions.sql
-- Track active signed-in users with per-device sessions and live cart subtotals

-- Ensure helper extensions
create extension if not exists pgcrypto;

-- Ensure profiles has fields we rely on
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='email'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN email text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='is_admin'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN is_admin boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='active'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN active boolean DEFAULT true;
  END IF;
END $$;

-- Active sessions table
create table if not exists public.active_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  email text,
  subtotal numeric,
  last_seen timestamptz not null default now(),
  user_agent text,
  ip text,
  force_sign_out boolean not null default false,
  primary key (user_id, device_id)
);

alter table public.active_sessions enable row level security;

-- Helper function: check if current user is admin
create or replace function public.is_admin_user() returns boolean language sql stable as $$
  select coalesce((
    select is_admin from public.profiles where id = auth.uid()
  ), false);
$$;

-- Policies
-- Users can view their own session rows
drop policy if exists "active_sessions_select_own" on public.active_sessions;
create policy "active_sessions_select_own" on public.active_sessions
  for select using (auth.uid() = user_id);

-- Admins can view all
drop policy if exists "active_sessions_select_admin" on public.active_sessions;
create policy "active_sessions_select_admin" on public.active_sessions
  for select using (public.is_admin_user());

-- Users can insert/update their own rows (heartbeat)
drop policy if exists "active_sessions_upsert_own" on public.active_sessions;
create policy "active_sessions_upsert_own" on public.active_sessions
  for insert with check (auth.uid() = user_id);

create policy "active_sessions_update_own" on public.active_sessions
  for update using (auth.uid() = user_id);

-- Admins can update any row (to force sign-out)
drop policy if exists "active_sessions_update_admin" on public.active_sessions;
create policy "active_sessions_update_admin" on public.active_sessions
  for update using (public.is_admin_user());

-- Optional index for recency queries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='active_sessions' AND indexname='idx_active_sessions_last_seen'
  ) THEN
    CREATE INDEX idx_active_sessions_last_seen ON public.active_sessions (last_seen DESC);
  END IF;
END $$;
