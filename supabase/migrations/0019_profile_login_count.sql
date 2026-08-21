-- Count how many times a user has signed into the NobleCart UI.
-- Clients call record_profile_login() after a successful sign-in; they cannot
-- write login_count directly (column stays out of authenticated UPDATE grants).

alter table public.profiles
  add column if not exists login_count integer not null default 0;

alter table public.profiles
  add column if not exists last_login_at timestamptz;

comment on column public.profiles.login_count is
  'Number of successful NobleCart UI sign-ins.';

comment on column public.profiles.last_login_at is
  'Timestamp of the most recent NobleCart UI sign-in.';

create or replace function public.record_profile_login()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_count integer;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  update public.profiles
  set
    login_count = coalesce(login_count, 0) + 1,
    last_login_at = now(),
    active = true
  where id = uid
  returning login_count into new_count;

  if new_count is null then
    insert into public.profiles (id, active, login_count, last_login_at)
    values (uid, true, 1, now())
    on conflict (id) do update
      set
        login_count = coalesce(profiles.login_count, 0) + 1,
        last_login_at = now(),
        active = true
    returning login_count into new_count;
  end if;

  return new_count;
end;
$$;

grant execute on function public.record_profile_login() to authenticated;
