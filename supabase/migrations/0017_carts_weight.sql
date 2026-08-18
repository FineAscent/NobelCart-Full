-- Live cart scale weight (Pi PATCHes weight_kg; kiosk subscribes by cart_id).
-- Table may already exist in prod; this is idempotent.

create table if not exists public.carts (
  cart_id text primary key,
  weight_kg numeric,
  user_id uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.carts
  add column if not exists weight_kg numeric;

alter table public.carts
  add column if not exists user_id uuid;

alter table public.carts
  add column if not exists updated_at timestamptz not null default now();

create index if not exists carts_updated_at_idx on public.carts (updated_at desc);

-- Keep updated_at fresh on weight writes (helps realtime clients).
create or replace function public.carts_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists carts_touch_updated_at on public.carts;
create trigger carts_touch_updated_at
  before update on public.carts
  for each row
  execute function public.carts_touch_updated_at();

alter table public.carts enable row level security;

drop policy if exists carts_select_anon on public.carts;
create policy carts_select_anon
  on public.carts
  for select
  to anon, authenticated
  using (true);

-- Writes go through the Pi service role (bypasses RLS). No client updates of weight.

do $$
begin
  alter publication supabase_realtime add table public.carts;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

comment on table public.carts is
  'One row per physical cart. Pi streams weight_kg; kiosk ?cart= must match cart_id.';
