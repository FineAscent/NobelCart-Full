-- Admin levels: 1 (default), 2, 3 (can grant/change levels).
-- is_admin stays the gate for "is this person an admin at all".
-- admin_level only matters when is_admin = true.

alter table public.profiles
  add column if not exists admin_level smallint;

-- Existing admins become level 1 by default.
update public.profiles
set admin_level = 1
where is_admin = true
  and (admin_level is null or admin_level < 1 or admin_level > 3);

-- Non-admins have no level.
update public.profiles
set admin_level = null
where is_admin = false
  and admin_level is not null;

alter table public.profiles
  drop constraint if exists profiles_admin_level_check;

alter table public.profiles
  add constraint profiles_admin_level_check
  check (
    (is_admin = false and admin_level is null)
    or (is_admin = true and admin_level in (1, 2, 3))
  );

comment on column public.profiles.admin_level is
  '1=default admin, 2=elevated, 3=can grant admin levels. Null when is_admin is false.';

-- Keep is_admin / admin_level out of normal client grants (same posture as 0012).
revoke insert, update on public.profiles from authenticated;
grant insert (id, email, display_name, active, show_allergy_caution, policy_accepted, policy_accepted_at, policy_version)
  on public.profiles to authenticated;
grant update (email, display_name, active, show_allergy_caution, policy_accepted, policy_accepted_at, policy_version)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.admin_level()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(is_admin, false) then coalesce(admin_level, 1)
    else 0
  end
  from public.profiles
  where id = auth.uid();
$$;

create or replace function public.is_admin_at_least(min_level integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.admin_level() >= coalesce(min_level, 1);
$$;

revoke all on function public.admin_level() from public;
revoke all on function public.is_admin_at_least(integer) from public;
grant execute on function public.admin_level() to authenticated;
grant execute on function public.is_admin_at_least(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Only level-3 admins may grant / change admin access.
-- ---------------------------------------------------------------------------
create or replace function public.set_admin_access(
  target_user_id uuid,
  make_admin boolean,
  new_level integer default 1
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_level integer := public.admin_level();
  target public.profiles;
  level3_count integer;
  next_level integer;
begin
  if caller_level < 3 then
    raise exception 'Only admin level 3 can change admin access'
      using errcode = '42501';
  end if;

  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  select * into target from public.profiles where id = target_user_id;
  if not found then
    raise exception 'User profile not found';
  end if;

  if make_admin then
    next_level := coalesce(new_level, 1);
    if next_level not in (1, 2, 3) then
      raise exception 'admin_level must be 1, 2, or 3';
    end if;
  else
    next_level := null;
  end if;

  -- Do not lock yourself out as the last level-3 admin.
  if target_user_id = auth.uid()
     and coalesce(target.is_admin, false)
     and coalesce(target.admin_level, 1) = 3
     and (not make_admin or next_level < 3) then
    select count(*) into level3_count
    from public.profiles
    where is_admin = true and admin_level = 3;
    if level3_count <= 1 then
      raise exception 'Cannot remove or demote the last admin level 3 account';
    end if;
  end if;

  update public.profiles
  set is_admin = make_admin,
      admin_level = next_level
  where id = target_user_id
  returning * into target;

  return target;
end;
$$;

revoke all on function public.set_admin_access(uuid, boolean, integer) from public;
grant execute on function public.set_admin_access(uuid, boolean, integer) to authenticated;

-- Optional: promote your first level-3 admin in SQL once:
--   update public.profiles
--   set is_admin = true, admin_level = 3
--   where email = 'you@example.com';
