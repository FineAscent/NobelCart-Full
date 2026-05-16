-- 0011_cart_qr_sessions.sql
-- QR login sessions: links a cart kiosk session to a mobile app user
-- Flow: kiosk INSERTs pending row -> app scans QR (cart_id) -> app calls
--       qr-cart-approve edge fn -> edge fn UPDATEs row to approved with token_hash
--       -> kiosk Realtime subscription fires -> kiosk calls verifyOtp to sign in

create table if not exists public.cart_qr_sessions (
  id uuid primary key default gen_random_uuid(),
  cart_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'expired')),
  user_id uuid references auth.users(id) on delete set null,
  token_hash text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes'
);

alter table public.cart_qr_sessions enable row level security;

-- Anon (kiosk) can insert new pending sessions
create policy "qr_sessions_insert_anon" on public.cart_qr_sessions
  for insert to anon
  with check (
    status = 'pending'
    and user_id is null
    and token_hash is null
  );

-- Anon (kiosk) can read non-expired sessions (required for Realtime subscription)
create policy "qr_sessions_select_anon" on public.cart_qr_sessions
  for select to anon
  using (expires_at > now());

-- Enable Realtime so kiosks receive live updates via postgres_changes
alter publication supabase_realtime add table public.cart_qr_sessions;

-- Indexes for cart_id lookups and expiry-based cleanup
create index if not exists idx_cart_qr_sessions_cart_id
  on public.cart_qr_sessions (cart_id);

create index if not exists idx_cart_qr_sessions_expires
  on public.cart_qr_sessions (expires_at);
