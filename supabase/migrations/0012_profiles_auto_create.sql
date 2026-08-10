-- Populate public.profiles automatically for every auth user.
--
-- Until now a profile row was only created by a client-side upsert in signin.html,
-- which runs on sign-in. Anyone who signed up but never completed a sign-in had no
-- profile row at all, so they were invisible to the admin views. The signup form
-- also stored the user's name only in auth.users.raw_user_meta_data.full_name and
-- never copied it into profiles.display_name.

-- 1. Create the profile row at signup time.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, active)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    true
  )
  on conflict (id) do update
    set email        = excluded.email,
        display_name = coalesce(profiles.display_name, excluded.display_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Keep profiles.email in sync when a user changes their address.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- 3. Backfill users who never got a profile row.
insert into public.profiles (id, email, display_name, active)
select
  u.id,
  u.email,
  nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', '')), ''),
  true
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- 4. Fill gaps on rows that predate this migration.
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

update public.profiles p
set display_name = nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', '')), '')
from auth.users u
where u.id = p.id
  and p.display_name is null
  and nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', '')), '') is not null;

-- 5. Stop users from granting themselves admin.
--    RLS on profiles only checks auth.uid() = id, so a signed-in user could otherwise
--    upsert is_admin = true onto their own row and then read every other profile via
--    the "Admins can view all profiles" policy. Column-level grants only take effect
--    once the table-level privilege is removed.
revoke insert, update on public.profiles from authenticated;
grant insert (id, email, display_name, active, show_allergy_caution)
  on public.profiles to authenticated;
grant update (email, display_name, active, show_allergy_caution)
  on public.profiles to authenticated;

-- To promote an admin, run this manually (the client can no longer set is_admin):
--   update public.profiles set is_admin = true where email = 'you@example.com';
