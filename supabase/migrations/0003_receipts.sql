-- Receipts table to store Stripe checkout receipts per user
create table if not exists public.receipts (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null unique,
  currency text not null default 'USD',
  amount_total_cents bigint not null default 0,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.receipts enable row level security;

-- Users can insert their own receipt rows (if coming from client)
do $$ begin
  create policy "insert_own_receipt"
    on public.receipts
    for insert
    to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Users can select their own receipts
do $$ begin
  create policy "select_own_receipts"
    on public.receipts
    for select
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Users can update their own receipts (e.g., idempotent upsert by session_id)
do $$ begin
  create policy "update_own_receipts"
    on public.receipts
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
