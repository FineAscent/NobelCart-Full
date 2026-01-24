-- Checkout Items table to track individual products purchased in each receipt
create table if not exists public.checkout_items (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  receipt_id bigint not null references public.receipts(id) on delete cascade,
  product_id text,
  product_name text not null,
  quantity numeric not null,
  unit_price_cents bigint not null,
  total_price_cents bigint not null,
  is_weighted boolean default false,
  unit text,
  created_at timestamptz not null default now()
);

-- Create index on user_id and receipt_id for faster queries
create index if not exists idx_checkout_items_user_id on public.checkout_items(user_id);
create index if not exists idx_checkout_items_receipt_id on public.checkout_items(receipt_id);
create index if not exists idx_checkout_items_created_at on public.checkout_items(created_at desc);

alter table public.checkout_items enable row level security;

-- Users can insert their own checkout items
do $$ begin
  create policy "insert_own_checkout_items"
    on public.checkout_items
    for insert
    to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Users can select their own checkout items
do $$ begin
  create policy "select_own_checkout_items"
    on public.checkout_items
    for select
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Users can update their own checkout items
do $$ begin
  create policy "update_own_checkout_items"
    on public.checkout_items
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
