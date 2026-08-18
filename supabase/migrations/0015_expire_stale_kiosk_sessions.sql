-- Max kiosk session lifetime + abandoned-session cleanup.
--
-- Nobody reasonably shops on one cart for half a day. After 4 hours from
-- session start, or if the kiosk stops heartbeating for 30 minutes, mark the
-- row force_sign_out = true. The existing client realtime watcher then signs
-- the member out locally (same path as the admin "Force Sign-out" button).

-- 1. Remember when this device session began (not refreshed by heartbeats).
alter table public.active_sessions
  add column if not exists session_started_at timestamptz;

update public.active_sessions
set session_started_at = coalesce(session_started_at, last_seen, now())
where session_started_at is null;

alter table public.active_sessions
  alter column session_started_at set default now();

alter table public.active_sessions
  alter column session_started_at set not null;

-- Even if a client upsert tries to rewrite it, keep the original start time.
create or replace function public.preserve_session_started_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.session_started_at := old.session_started_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_preserve_session_started_at on public.active_sessions;
create trigger trg_preserve_session_started_at
  before update on public.active_sessions
  for each row execute function public.preserve_session_started_at();

create index if not exists idx_active_sessions_started_at
  on public.active_sessions (session_started_at);

-- 2. Expire stale / over-long sessions.
--    - Absolute max: 4 hours since session_started_at
--    - Abandoned:    no heartbeat for 30 minutes
create or replace function public.expire_stale_kiosk_sessions(
  max_age interval default interval '4 hours',
  stale_after interval default interval '30 minutes'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.active_sessions
  set force_sign_out = true
  where force_sign_out = false
    and (
      session_started_at < now() - max_age
      or last_seen < now() - stale_after
    );

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.expire_stale_kiosk_sessions(interval, interval) from public;
grant execute on function public.expire_stale_kiosk_sessions(interval, interval) to service_role;

comment on function public.expire_stale_kiosk_sessions(interval, interval) is
  'Sets force_sign_out on kiosk sessions older than max_age or with last_seen older than stale_after.';

-- 3. Run every 10 minutes when pg_cron is available.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'expire-stale-kiosk-sessions') then
      perform cron.unschedule('expire-stale-kiosk-sessions');
    end if;
    perform cron.schedule(
      'expire-stale-kiosk-sessions',
      '*/10 * * * *',
      $cron$ select public.expire_stale_kiosk_sessions(); $cron$
    );
  else
    raise notice 'pg_cron not installed — run select public.expire_stale_kiosk_sessions(); periodically, or enable pg_cron.';
  end if;
exception
  when others then
    raise notice 'pg_cron not scheduled for session expiry: %', sqlerrm;
end;
$$;
