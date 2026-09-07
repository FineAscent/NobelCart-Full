-- Pending signups: no auth.users row until OTP succeeds.
-- Abandoned pending rows expire and are deleted; orphan unverified auth users cleaned faster.

create table if not exists public.pending_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  phone text not null,
  full_name text not null,
  date_of_birth date not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists pending_signups_phone_unique
  on public.pending_signups (phone);

create unique index if not exists pending_signups_email_unique
  on public.pending_signups (email);

create index if not exists pending_signups_expires_at_idx
  on public.pending_signups (expires_at);

alter table public.pending_signups enable row level security;
-- service role / edge only — no client policies

-- Drop expired pending signups (abandoned OTP = no account)
create or replace function public.cleanup_pending_signups()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.pending_signups
  where expires_at < now()
     or created_at < now() - interval '1 hour';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.cleanup_pending_signups() from public;
grant execute on function public.cleanup_pending_signups() to service_role;

-- Faster orphan cleanup: unverified auth accounts older than 1 hour (not 24h)
create or replace function public.cleanup_unverified_users()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
  r record;
begin
  perform public.cleanup_pending_signups();

  for r in
    select p.id
    from public.profiles p
    where coalesce(p.phone_verified, false) = false
      and coalesce(p.is_admin, false) = false
      and p.created_at < now() - interval '1 hour'
  loop
    delete from auth.users where id = r.id;
    deleted_count := deleted_count + 1;
  end loop;
  return deleted_count;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'cleanup-pending-signups') then
      perform cron.unschedule('cleanup-pending-signups');
    end if;
    perform cron.schedule(
      'cleanup-pending-signups',
      '*/15 * * * *',
      $cron$ select public.cleanup_pending_signups(); $cron$
    );
  end if;
exception when others then
  raise notice 'pg_cron pending cleanup not scheduled: %', sqlerrm;
end $$;
