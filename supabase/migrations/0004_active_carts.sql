-- Active carts tracking
create table if not exists public.active_carts (
  user_id uuid not null,
  client_id text not null,
  email text,
  subtotal_cents integer default 0 not null,
  status text default 'active' not null,
  updated_at timestamptz default now() not null,
  primary key (user_id, client_id)
);

alter table public.active_carts enable row level security;

-- Only the authenticated user can insert/update their own row with matching client_id
create policy if not exists active_carts_write_self on public.active_carts
  for insert with check (auth.uid() = user_id)
  using (auth.uid() = user_id);

create policy if not exists active_carts_update_self on public.active_carts
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Users can read their own rows
create policy if not exists active_carts_select_self on public.active_carts
  for select using (auth.uid() = user_id);
