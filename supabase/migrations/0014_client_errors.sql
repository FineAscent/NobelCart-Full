-- Client error log for kiosk pages (foundation only).
--
-- Step 1 of the error tracker:
--   - table + indexes
--   - signed-in members may INSERT their own rows
--   - admins may SELECT (and later UPDATE when the admin UI lands)
--   - rows older than 7 days are purged by cleanup_client_errors()
--
-- Not in this migration: edge function, browser catcher, admin UI.

create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),

  -- Who / where
  user_id     uuid not null references auth.users (id) on delete cascade,
  cart_id     text,
  page        text not null,
  source      text not null default 'js'
                check (source in ('js', 'supabase', 'stripe', 'network', 'other')),

  -- What happened
  message     text not null,
  stack       text,
  severity    text not null default 'error'
                check (severity in ('error', 'warn')),

  -- Admin workflow (UI comes later; defaults keep Phase 1 simple)
  status      text not null default 'new'
                check (status in ('new', 'seen', 'resolved')),

  -- Light fingerprint for future dedupe (message + page); nullable for now
  fingerprint text
);

create index if not exists client_errors_created_at_idx
  on public.client_errors (created_at desc);

create index if not exists client_errors_status_created_idx
  on public.client_errors (status, created_at desc);

create index if not exists client_errors_user_id_idx
  on public.client_errors (user_id);

create index if not exists client_errors_cart_id_idx
  on public.client_errors (cart_id)
  where cart_id is not null;

comment on table public.client_errors is
  'Kiosk client errors reported by signed-in members. Retained 7 days.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.client_errors enable row level security;

-- Members: insert only as themselves (no forging another user_id).
create policy "client_errors_insert_own"
  on public.client_errors
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- Admins: read everything (uses public.is_admin() from 0010).
create policy "client_errors_select_admin"
  on public.client_errors
  for select
  to authenticated
  using (public.is_admin());

-- Admins: update status later from the Error Log UI.
create policy "client_errors_update_admin"
  on public.client_errors
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No delete for authenticated clients. Cleanup runs as a security definer
-- function (or service role) so members cannot wipe the log.
revoke all on public.client_errors from anon;
grant select, insert, update on public.client_errors to authenticated;
grant usage, select on sequence public.client_errors_id_seq to authenticated;

-- ---------------------------------------------------------------------------
-- 7-day retention
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_client_errors()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted integer;
begin
  delete from public.client_errors
  where created_at < now() - interval '7 days';
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.cleanup_client_errors() from public;
grant execute on function public.cleanup_client_errors() to service_role;

-- Schedule daily cleanup when pg_cron is available (Supabase Pro / enabled projects).
-- Safe no-op on projects without the extension.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'cleanup-client-errors') then
      perform cron.unschedule('cleanup-client-errors');
    end if;
    perform cron.schedule(
      'cleanup-client-errors',
      '15 4 * * *',  -- 04:15 UTC daily
      $cron$ select public.cleanup_client_errors(); $cron$
    );
  else
    raise notice 'pg_cron not installed — run select public.cleanup_client_errors(); daily, or enable pg_cron.';
  end if;
exception
  when others then
    raise notice 'pg_cron not scheduled for client_errors cleanup: %', sqlerrm;
end;
$$;
