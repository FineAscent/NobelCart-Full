-- On-demand scale sessions: kiosk sets scale_wanted; Pi only reads HX711 while true.

alter table public.carts
  add column if not exists scale_wanted boolean not null default false;

alter table public.carts
  add column if not exists scale_wanted_at timestamptz;

comment on column public.carts.scale_wanted is
  'Kiosk sets true while the weight modal is open. Pi streams weight_kg only then.';

-- Kiosk may flip the session flag (and bind user_id). Only the Pi service role writes weight_kg.
revoke update on public.carts from anon, authenticated;
grant update (scale_wanted, scale_wanted_at, user_id) on public.carts to anon, authenticated;

drop policy if exists carts_update_scale_wanted on public.carts;
create policy carts_update_scale_wanted
  on public.carts
  for update
  to anon, authenticated
  using (true)
  with check (true);
