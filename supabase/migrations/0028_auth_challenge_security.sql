-- All RPCs are service-role only. Tokens and code hashes are computed in Edge functions.
alter table public.pending_signups add column if not exists verification_token_hash text;
alter table public.pending_signups add column if not exists consumed_at timestamptz;
alter table public.otp_verifications add column if not exists verification_token_hash text;
alter table public.otp_verifications add column if not exists consumed_at timestamptz;

create unique index if not exists pending_signups_token_idx on public.pending_signups(verification_token_hash) where verification_token_hash is not null;
create unique index if not exists otp_verifications_token_idx on public.otp_verifications(verification_token_hash) where verification_token_hash is not null;

create table if not exists public.auth_hourly_limits (
  bucket text primary key,
  started_at timestamptz not null,
  last_at timestamptz not null,
  requests integer not null
);
alter table public.auth_hourly_limits enable row level security;
revoke all on public.auth_hourly_limits from public, anon, authenticated;

-- Fixed one-hour windows anchored at the first request. Acquire locks in a stable order.
-- A rejected reservation changes no counters. Send failures still count to stop provider abuse.
create or replace function public.auth_reserve_limits(p_keys text[], p_limit integer, p_cooldown integer)
returns integer language plpgsql security definer set search_path = public as $$
declare k text; r public.auth_hourly_limits; t timestamptz := clock_timestamp(); wait_seconds integer := 0;
begin
  for k in select distinct unnest(p_keys) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('auth-limit:' || k, 0));
  end loop;
  for k in select distinct unnest(p_keys) order by 1 loop
    select * into r from public.auth_hourly_limits where bucket = k;
    if found and r.started_at + interval '1 hour' > t then
      if r.requests >= p_limit then
        wait_seconds := greatest(wait_seconds, ceil(extract(epoch from r.started_at + interval '1 hour' - t))::integer);
      end if;
      if p_cooldown > 0 then
        wait_seconds := greatest(wait_seconds, ceil(extract(epoch from r.last_at + make_interval(secs => p_cooldown) - t))::integer);
      end if;
    end if;
  end loop;
  if wait_seconds > 0 then return wait_seconds; end if;
  for k in select distinct unnest(p_keys) order by 1 loop
    insert into public.auth_hourly_limits as limits (bucket, started_at, last_at, requests)
    values (k, t, t, 1)
    on conflict (bucket) do update set
      requests = case when limits.started_at + interval '1 hour' <= t then 1 else limits.requests + 1 end,
      started_at = case when limits.started_at + interval '1 hour' <= t then t else limits.started_at end,
      last_at = t;
  end loop;
  return 0;
end;
$$;

-- This transaction owns pending-signup creation/updates and every OTP send reservation.
-- One short auth lock keeps overlapping old/new email and phone mutations deadlock-free.
-- Network/provider calls happen only after the transaction commits and never hold the lock.
create or replace function public.auth_prepare_challenge(p_action text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pending public.pending_signups; legacy public.otp_verifications; profile public.profiles;
  phone_value text := p_data->>'phone'; email_value text := lower(p_data->>'email');
  token_hash text := p_data->>'token_hash'; supplied_hash text := p_data->>'supplied_token_hash';
  code_hash_value text := p_data->>'code_hash'; t timestamptz := clock_timestamp(); wait_seconds integer;
  keys text[]; result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('auth-challenge-mutation', 0));
  t := clock_timestamp();
  if token_hash is null or length(token_hash) <> 64 or code_hash_value is null or length(code_hash_value) <> 64 then
    return jsonb_build_object('status', 'invalid_session');
  end if;
  if p_action = 'signup' then
    if exists (select 1 from public.profiles where (email = email_value or phone = phone_value) ) then
      return jsonb_build_object('status', 'unavailable');
    end if;
    -- A new caller cannot overwrite another caller's pending signup.
    if supplied_hash is not null then
      select * into pending from public.pending_signups where verification_token_hash = supplied_hash for update;
    end if;
    if exists (select 1 from public.pending_signups where (email = email_value or phone = phone_value)
      and id is distinct from pending.id and expires_at > t) then
      return jsonb_build_object('status', 'unavailable');
    end if;
    if pending.id is not null and pending.consumed_at is not null then
      return jsonb_build_object('status', 'invalid_session');
    end if;
    keys := array['send:phone:' || md5(phone_value), 'send:email:' || md5(email_value)];
    if pending.id is not null then
      keys := keys || array['send:phone:' || md5(pending.phone), 'send:email:' || md5(pending.email)];
    end if;
    wait_seconds := public.auth_reserve_limits(keys, 5, 60);
    if wait_seconds > 0 then return jsonb_build_object('status', 'limited', 'retry_after', wait_seconds); end if;
    -- Only expired challenges can be replaced without their secret token.
    delete from public.pending_signups where (email = email_value or phone = phone_value) and expires_at <= t and id is distinct from pending.id;
    if pending.id is not null then delete from public.pending_signups where id = pending.id; end if;
    insert into public.pending_signups (email, phone, full_name, date_of_birth, code_hash, expires_at,
      verification_token_hash, signup_source, sms_opt_in, sms_consent_version, sms_consent_text, sms_consent_at)
    values (email_value, phone_value, p_data->>'full_name', (p_data->>'date_of_birth')::date,
      code_hash_value, t + interval '10 minutes', token_hash, p_data->>'signup_source',
      coalesce((p_data->>'sms_opt_in')::boolean, false), p_data->>'sms_consent_version',
      p_data->>'sms_consent_text', (p_data->>'sms_consent_at')::timestamptz)
    returning * into pending;
    return jsonb_build_object('status', 'ok', 'kind', 'pending', 'record', to_jsonb(pending));
  end if;

  -- Other actions must prove knowledge of the secret before seeing or modifying a row.
  if supplied_hash is null then return jsonb_build_object('status', 'invalid_session'); end if;
  select * into pending from public.pending_signups where verification_token_hash = supplied_hash for update;
  if pending.id is not null then
    if pending.expires_at <= t or pending.consumed_at is not null then return jsonb_build_object('status', 'invalid_session'); end if;
    if p_action = 'change_phone' then
      if pending.id::text <> p_data->>'pending_id' then return jsonb_build_object('status', 'invalid_session'); end if;
      if exists (select 1 from public.profiles where phone = phone_value and phone_verified)
        or exists (select 1 from public.pending_signups where phone = phone_value and id <> pending.id and expires_at > t) then
        return jsonb_build_object('status', 'unavailable');
      end if;
    elsif p_action <> 'resend' or phone_value <> pending.phone then
      return jsonb_build_object('status', 'invalid_session');
    end if;
    keys := array['send:phone:' || md5(phone_value), 'send:phone:' || md5(pending.phone), 'send:email:' || md5(pending.email)];
    wait_seconds := public.auth_reserve_limits(keys, 5, 60);
    if wait_seconds > 0 then return jsonb_build_object('status', 'limited', 'retry_after', wait_seconds); end if;
    delete from public.pending_signups where phone = phone_value and expires_at <= t and id <> pending.id;
    update public.pending_signups set phone = phone_value, code_hash = code_hash_value, attempts = 0,
      expires_at = t + interval '10 minutes', consumed_at = null,
      sms_opt_in = case when phone <> phone_value then false else sms_opt_in end,
      sms_consent_version = case when phone <> phone_value then null else sms_consent_version end,
      sms_consent_text = case when phone <> phone_value then null else sms_consent_text end,
      sms_consent_at = case when phone <> phone_value then null else sms_consent_at end
    where id = pending.id returning * into pending;
    return jsonb_build_object('status', 'ok', 'kind', 'pending', 'record', to_jsonb(pending));
  end if;

  -- Legacy issuance is permitted only after the Edge function checks the password.
  if p_action = 'legacy' then
    select * into profile from public.profiles where id::text = p_data->>'user_id' and not phone_verified for update;
    if not found or profile.phone <> phone_value or lower(profile.email) <> email_value then
      return jsonb_build_object('status', 'invalid_session');
    end if;
  elsif p_action = 'resend' then
    select * into legacy from public.otp_verifications where verification_token_hash = supplied_hash and phone = phone_value for update;
    if not found or legacy.expires_at <= t or legacy.consumed_at is not null then return jsonb_build_object('status', 'invalid_session'); end if;
    select * into profile from public.profiles where id = legacy.user_id and not phone_verified for update;
    if not found then return jsonb_build_object('status', 'invalid_session'); end if;
    email_value := lower(profile.email);
  else
    return jsonb_build_object('status', 'invalid_session');
  end if;
  wait_seconds := public.auth_reserve_limits(array['send:phone:' || md5(phone_value), 'send:email:' || md5(email_value)], 5, 60);
  if wait_seconds > 0 then return jsonb_build_object('status', 'limited', 'retry_after', wait_seconds); end if;
  delete from public.otp_verifications where user_id = profile.id;
  insert into public.otp_verifications (user_id, phone, code_hash, expires_at, verification_token_hash)
    values (profile.id, phone_value, code_hash_value, t + interval '10 minutes', token_hash) returning * into legacy;
  result := to_jsonb(legacy) || jsonb_build_object('email', profile.email);
  return jsonb_build_object('status', 'ok', 'kind', 'legacy', 'record', result);
end;
$$;

-- A correct code is consumed in the same locked transaction that checks attempts.
create or replace function public.auth_check_challenge(p_phone text, p_token_hash text, p_code_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pending public.pending_signups; legacy public.otp_verifications; record_value jsonb;
  kind_value text; email_value text; wait_seconds integer; t timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('auth-challenge-mutation', 0));
  t := clock_timestamp();
  if p_token_hash is null or length(p_token_hash) <> 64 or p_code_hash is null or length(p_code_hash) <> 64 then
    return jsonb_build_object('status', 'invalid_session');
  end if;
  select * into pending from public.pending_signups where phone = p_phone and verification_token_hash = p_token_hash for update;
  if found then
    record_value := to_jsonb(pending); kind_value := 'pending'; email_value := pending.email;
  else
    select * into legacy from public.otp_verifications where phone = p_phone and verification_token_hash = p_token_hash for update;
    if not found then return jsonb_build_object('status', 'invalid_session'); end if;
    record_value := to_jsonb(legacy); kind_value := 'legacy';
    select email into email_value from public.profiles where id = legacy.user_id;
  end if;
  if (record_value->>'expires_at')::timestamptz <= t or record_value->>'consumed_at' is not null then
    return jsonb_build_object('status', 'invalid_session');
  end if;
  wait_seconds := public.auth_reserve_limits(array['verify:phone:' || md5(p_phone), 'verify:email:' || md5(lower(email_value))], 10, 0);
  if wait_seconds > 0 then return jsonb_build_object('status', 'limited', 'retry_after', wait_seconds); end if;
  if (record_value->>'attempts')::integer >= 5 then return jsonb_build_object('status', 'locked'); end if;
  if kind_value = 'pending' then
    update public.pending_signups set attempts = attempts + 1,
      consumed_at = case when code_hash = p_code_hash then t else consumed_at end where id = pending.id;
  else
    update public.otp_verifications set attempts = attempts + 1,
      consumed_at = case when code_hash = p_code_hash then t else consumed_at end where id = legacy.id;
  end if;
  if record_value->>'code_hash' <> p_code_hash then return jsonb_build_object('status', 'invalid_code'); end if;
  return jsonb_build_object('status', 'ok', 'kind', kind_value, 'record', record_value);
end;
$$;

revoke all on function public.auth_reserve_limits(text[], integer, integer) from public, anon, authenticated;
revoke all on function public.auth_prepare_challenge(text, jsonb) from public, anon, authenticated;
revoke all on function public.auth_check_challenge(text, text, text) from public, anon, authenticated;
grant execute on function public.auth_reserve_limits(text[], integer, integer) to service_role;
grant execute on function public.auth_prepare_challenge(text, jsonb) to service_role;
grant execute on function public.auth_check_challenge(text, text, text) to service_role;

-- Reuse the existing pending-signup cleanup schedule; retain active hourly budgets.
create index if not exists auth_hourly_limits_started_at_idx on public.auth_hourly_limits(started_at);
create or replace function public.cleanup_pending_signups()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.pending_signups where expires_at < now() or created_at < now() - interval '1 hour';
  get diagnostics n = row_count;
  delete from public.auth_hourly_limits where started_at < now() - interval '2 hours';
  return n;
end;
$$;
revoke all on function public.cleanup_pending_signups() from public, anon, authenticated;
grant execute on function public.cleanup_pending_signups() to service_role;
