-- Record whether a user has accepted the NobleCart privacy policy.
--
-- The kiosk cannot reliably tell a signup from a sign-in: the QR/app flow calls
-- verifyOtp, which signs in an existing user and creates a brand-new one with the
-- same call. Gating on a stored flag instead of on "was this a signup" covers the
-- email signup, the app signup, and any existing account that never agreed.

alter table public.profiles
  add column if not exists policy_accepted boolean not null default false,
  add column if not exists policy_accepted_at timestamptz,
  add column if not exists policy_version text;

-- 1. Carry the agreement through signup metadata.
--    Email signups accept the policy *before* signUp is called, so the flag has to
--    survive a signup that returns no session (email confirmation enabled); the
--    client cannot write the row itself in that case.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Compared as text rather than cast to boolean: signup metadata is client
  -- supplied, and a stray value would make the cast raise and fail the signup.
  accepted boolean := lower(trim(coalesce(new.raw_user_meta_data->>'policy_accepted', '')))
                        in ('true', 't', '1', 'yes');
  version  text    := nullif(trim(coalesce(new.raw_user_meta_data->>'policy_version', '')), '');
begin
  insert into public.profiles (id, email, display_name, active, policy_accepted, policy_accepted_at, policy_version)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    true,
    accepted,
    case when accepted then now() end,
    case when accepted then version end
  )
  on conflict (id) do update
    set email              = excluded.email,
        display_name       = coalesce(profiles.display_name, excluded.display_name),
        -- Never revoke an agreement that was already recorded.
        policy_accepted    = profiles.policy_accepted or excluded.policy_accepted,
        policy_accepted_at = coalesce(profiles.policy_accepted_at, excluded.policy_accepted_at),
        policy_version     = coalesce(profiles.policy_version, excluded.policy_version);
  return new;
end;
$$;

-- 2. Let the client record its own acceptance.
--    0012 revoked table-level insert/update and re-granted per column, so new
--    columns are unwritable until they are granted explicitly.
grant insert (policy_accepted, policy_accepted_at, policy_version)
  on public.profiles to authenticated;
grant update (policy_accepted, policy_accepted_at, policy_version)
  on public.profiles to authenticated;

-- 3. Grandfather every account that already exists.
--    Only signups from here on are prompted. To instead force the whole existing
--    user base to accept on their next sign-in, delete this statement.
update public.profiles
set policy_accepted    = true,
    policy_accepted_at = coalesce(policy_accepted_at, now()),
    policy_version     = coalesce(policy_version, 'grandfathered')
where policy_accepted = false;
