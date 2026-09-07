-- Auth OTP (Brevo), phone verification, Stripe customer id, card fingerprints, bans.
-- Cutover: delete all non-admin customer auth users (admins preserved).

-- ---------------------------------------------------------------------------
-- 1. Profile columns
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists phone text,
  add column if not exists phone_verified boolean not null default false,
  add column if not exists date_of_birth date,
  add column if not exists stripe_customer_id text;

comment on column public.profiles.phone is
  'E.164 US phone (+1XXXXXXXXXX). Verified once via Brevo OTP at signup.';
comment on column public.profiles.phone_verified is
  'True only after successful signup OTP. Unverified accounts are cleaned up after 24h.';
comment on column public.profiles.stripe_customer_id is
  'Stripe Customer id (cus_…) created after phone verification.';

create unique index if not exists profiles_phone_unique
  on public.profiles (phone)
  where phone is not null;

create unique index if not exists profiles_stripe_customer_id_unique
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

-- Clients must not set verification / Stripe / phone themselves.
revoke insert, update on public.profiles from authenticated;
grant insert (id, email, display_name, active, show_allergy_caution, policy_accepted, policy_accepted_at, policy_version)
  on public.profiles to authenticated;
grant update (email, display_name, active, show_allergy_caution, policy_accepted, policy_accepted_at, policy_version)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. OTP verifications (hashed codes; service-role only)
-- ---------------------------------------------------------------------------
create table if not exists public.otp_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists otp_verifications_phone_idx
  on public.otp_verifications (phone);

create index if not exists otp_verifications_user_id_idx
  on public.otp_verifications (user_id);

create index if not exists otp_verifications_expires_at_idx
  on public.otp_verifications (expires_at);

alter table public.otp_verifications enable row level security;
-- No client policies: only service role / edge functions touch this table.

-- ---------------------------------------------------------------------------
-- 3. Banned identifiers (phone or card fingerprint)
-- ---------------------------------------------------------------------------
create table if not exists public.banned_identifiers (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('phone', 'card_fingerprint')),
  value text not null,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (type, value)
);

create index if not exists banned_identifiers_type_value_idx
  on public.banned_identifiers (type, value);

alter table public.banned_identifiers enable row level security;

drop policy if exists "Admins read banned_identifiers" on public.banned_identifiers;
create policy "Admins read banned_identifiers" on public.banned_identifiers
  for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins insert banned_identifiers" on public.banned_identifiers;
create policy "Admins insert banned_identifiers" on public.banned_identifiers
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admins delete banned_identifiers" on public.banned_identifiers;
create policy "Admins delete banned_identifiers" on public.banned_identifiers
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. Card fingerprints seen per user
-- ---------------------------------------------------------------------------
create table if not exists public.user_card_fingerprints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, fingerprint)
);

create index if not exists user_card_fingerprints_fingerprint_idx
  on public.user_card_fingerprints (fingerprint);

alter table public.user_card_fingerprints enable row level security;

drop policy if exists "Admins read user_card_fingerprints" on public.user_card_fingerprints;
create policy "Admins read user_card_fingerprints" on public.user_card_fingerprints
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5. Receipt fraud fields
-- ---------------------------------------------------------------------------
alter table public.receipts
  add column if not exists card_fingerprint text,
  add column if not exists fraud_status text not null default 'ok';

do $$ begin
  alter table public.receipts
    drop constraint if exists receipts_fraud_status_check;
  alter table public.receipts
    add constraint receipts_fraud_status_check
    check (fraud_status in ('ok', 'blocked_refunded'));
exception when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Admin helpers: ban / unban / deactivate without touching other users
-- ---------------------------------------------------------------------------
create or replace function public.ban_identifier(
  p_type text,
  p_value text,
  p_reason text default null
)
returns public.banned_identifiers
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.banned_identifiers;
  norm text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_type not in ('phone', 'card_fingerprint') then
    raise exception 'type must be phone or card_fingerprint';
  end if;
  norm := nullif(trim(p_value), '');
  if norm is null then
    raise exception 'value is required';
  end if;

  insert into public.banned_identifiers (type, value, reason, created_by)
  values (p_type, norm, nullif(trim(coalesce(p_reason, '')), ''), auth.uid())
  on conflict (type, value) do update
    set reason = coalesce(excluded.reason, banned_identifiers.reason)
  returning * into row;

  -- If banning a phone, deactivate matching profiles (does not delete them).
  if p_type = 'phone' then
    update public.profiles
    set active = false
    where phone = norm;
  end if;

  return row;
end;
$$;

create or replace function public.unban_identifier(p_type text, p_value text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  delete from public.banned_identifiers
  where type = p_type and value = trim(p_value);
  return found;
end;
$$;

create or replace function public.set_profile_active(target_user_id uuid, make_active boolean)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  update public.profiles
  set active = make_active
  where id = target_user_id
  returning * into row;
  if not found then
    raise exception 'User profile not found';
  end if;
  return row;
end;
$$;

revoke all on function public.ban_identifier(text, text, text) from public;
revoke all on function public.unban_identifier(text, text) from public;
revoke all on function public.set_profile_active(uuid, boolean) from public;
grant execute on function public.ban_identifier(text, text, text) to authenticated;
grant execute on function public.unban_identifier(text, text) to authenticated;
grant execute on function public.set_profile_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Cleanup unverified ghost accounts (24h)
-- ---------------------------------------------------------------------------
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
  for r in
    select p.id
    from public.profiles p
    where coalesce(p.phone_verified, false) = false
      and coalesce(p.is_admin, false) = false
      and p.created_at < now() - interval '24 hours'
  loop
    delete from auth.users where id = r.id;
    deleted_count := deleted_count + 1;
  end loop;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_unverified_users() from public;
grant execute on function public.cleanup_unverified_users() to service_role;
-- Invoked by cron / service role only; no grant to authenticated.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'cleanup-unverified-users') then
      perform cron.unschedule('cleanup-unverified-users');
    end if;
    perform cron.schedule(
      'cleanup-unverified-users',
      '15 * * * *',
      $cron$ select public.cleanup_unverified_users(); $cron$
    );
  else
    raise notice 'pg_cron not installed — run select public.cleanup_unverified_users(); hourly, or enable pg_cron.';
  end if;
exception when others then
  raise notice 'pg_cron not scheduled for unverified cleanup: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Cutover: wipe non-admin customer accounts
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id from public.profiles where coalesce(is_admin, false) = false
  loop
    delete from auth.users where id = r.id;
    n := n + 1;
  end loop;
  raise notice 'Cutover wiped % non-admin auth users', n;
end $$;
