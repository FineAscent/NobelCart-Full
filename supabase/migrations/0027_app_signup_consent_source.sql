-- The same auth API serves the app and kiosk. Preserve which signup flow
-- presented the disclosure; missing client_type from older clients means kiosk.
alter table public.pending_signups
  add column if not exists signup_source text not null default 'kiosk_signup'
  check (signup_source in ('kiosk_signup', 'app_signup'));
