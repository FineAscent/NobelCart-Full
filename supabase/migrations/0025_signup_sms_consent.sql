-- SMS consent is optional and independent of account/privacy-policy acceptance.
alter table public.pending_signups
  add column if not exists sms_opt_in boolean not null default false,
  add column if not exists sms_consent_version text,
  add column if not exists sms_consent_text text,
  add column if not exists sms_consent_at timestamptz;

create table if not exists public.sms_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text not null,
  opted_in boolean not null default false,
  consent_version text,
  consent_text text,
  consented_at timestamptz,
  source text not null default 'kiosk_signup',
  recorded_at timestamptz not null default now(),
  constraint sms_consents_opt_in_evidence check (
    not opted_in or (consent_version is not null and consent_text is not null and consented_at is not null)
  )
);

alter table public.sms_consents enable row level security;
revoke all on public.sms_consents from anon, authenticated;
grant select on public.sms_consents to authenticated;
grant all on public.sms_consents to service_role;
create policy sms_consents_read_own on public.sms_consents
  for select to authenticated using ((select auth.uid()) = user_id);
-- Only trusted server functions may create or change consent records.
-- Existing accounts are not opted in, and general policy acceptance never enrolls them.
