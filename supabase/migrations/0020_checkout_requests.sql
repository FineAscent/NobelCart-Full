-- Checkout admin approval: live cart snapshots + frozen checkout requests.
-- Shoppers wait after Checkout; Admin L1+ reviews items, then approves pay.

-- ---------------------------------------------------------------------------
-- Live shopping snapshot on the existing heartbeat row
-- ---------------------------------------------------------------------------
alter table public.active_sessions
  add column if not exists cart_id text;

alter table public.active_sessions
  add column if not exists items jsonb not null default '[]'::jsonb;

comment on column public.active_sessions.cart_id is
  'Physical kiosk cart_id from the device heartbeat.';
comment on column public.active_sessions.items is
  'Compact live basket: [{id, name, qty, price, weighted, unit}].';

create index if not exists idx_active_sessions_cart_id
  on public.active_sessions (cart_id)
  where cart_id is not null;

-- ---------------------------------------------------------------------------
-- Frozen checkout requests
-- ---------------------------------------------------------------------------
create table if not exists public.checkout_requests (
  id uuid primary key default gen_random_uuid(),
  cart_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  status text not null default 'pending',
  items jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkout_requests_status_check check (
    status in ('pending', 'items_good', 'approved', 'denied', 'cancelled', 'expired')
  )
);

comment on table public.checkout_requests is
  'One open checkout approval per physical cart. Items are frozen at request time.';

create unique index if not exists checkout_requests_one_open_per_cart
  on public.checkout_requests (cart_id)
  where status in ('pending', 'items_good');

create index if not exists checkout_requests_status_created_idx
  on public.checkout_requests (status, created_at);

create index if not exists checkout_requests_user_idx
  on public.checkout_requests (user_id, created_at desc);

create or replace function public.checkout_requests_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists checkout_requests_touch_updated_at on public.checkout_requests;
create trigger checkout_requests_touch_updated_at
  before update on public.checkout_requests
  for each row execute function public.checkout_requests_touch_updated_at();

alter table public.checkout_requests enable row level security;

-- Mutations go through RPCs (security definer). Clients may only SELECT.
revoke insert, update, delete on public.checkout_requests from anon, authenticated, public;
grant select on public.checkout_requests to authenticated;

drop policy if exists checkout_requests_select_own on public.checkout_requests;
create policy checkout_requests_select_own
  on public.checkout_requests
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists checkout_requests_select_admin on public.checkout_requests;
create policy checkout_requests_select_admin
  on public.checkout_requests
  for select
  to authenticated
  using (public.is_admin_at_least(1));

do $$
begin
  begin
    alter publication supabase_realtime add table public.checkout_requests;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

alter table public.checkout_requests replica identity full;

-- ---------------------------------------------------------------------------
-- Expire stale open requests (10 minutes)
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_checkout_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.checkout_requests
  set
    status = 'expired',
    resolved_at = coalesce(resolved_at, now())
  where status in ('pending', 'items_good')
    and created_at < now() - interval '10 minutes';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.expire_stale_checkout_requests() from public;
grant execute on function public.expire_stale_checkout_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- Shopper: open or reuse the one pending request for this cart
-- ---------------------------------------------------------------------------
create or replace function public.open_checkout_request(
  p_cart_id text,
  p_items jsonb,
  p_subtotal numeric,
  p_email text default null
)
returns public.checkout_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing public.checkout_requests;
  created public.checkout_requests;
  snapshot jsonb := coalesce(p_items, '[]'::jsonb);
  total numeric := coalesce(p_subtotal, 0);
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_cart_id is null or length(trim(p_cart_id)) = 0 then
    raise exception 'cart_id is required';
  end if;
  if jsonb_typeof(snapshot) is distinct from 'array' or jsonb_array_length(snapshot) < 1 then
    raise exception 'Cart is empty';
  end if;

  perform public.expire_stale_checkout_requests();
  perform pg_advisory_xact_lock(hashtext(trim(p_cart_id)));

  select * into existing
  from public.checkout_requests
  where cart_id = trim(p_cart_id)
    and status in ('pending', 'items_good')
  for update;

  if found then
    if existing.user_id <> uid then
      update public.checkout_requests
      set
        status = 'expired',
        resolved_at = now()
      where id = existing.id;
    else
      update public.checkout_requests
      set
        items = snapshot,
        subtotal = total,
        email = coalesce(nullif(trim(p_email), ''), existing.email)
      where id = existing.id
      returning * into created;
      return created;
    end if;
  end if;

  insert into public.checkout_requests (
    cart_id, user_id, email, status, items, subtotal
  ) values (
    trim(p_cart_id),
    uid,
    nullif(trim(p_email), ''),
    'pending',
    snapshot,
    total
  )
  returning * into created;

  return created;
end;
$$;

revoke all on function public.open_checkout_request(text, jsonb, numeric, text) from public;
grant execute on function public.open_checkout_request(text, jsonb, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Shopper: cancel own open request
-- ---------------------------------------------------------------------------
create or replace function public.cancel_checkout_request(p_request_id uuid)
returns public.checkout_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.checkout_requests;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request id is required';
  end if;

  select * into row
  from public.checkout_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Checkout request not found';
  end if;
  if row.user_id <> uid then
    raise exception 'Not your checkout request' using errcode = '42501';
  end if;
  if row.status not in ('pending', 'items_good') then
    return row;
  end if;

  update public.checkout_requests
  set
    status = 'cancelled',
    resolved_at = now()
  where id = p_request_id
  returning * into row;

  return row;
end;
$$;

revoke all on function public.cancel_checkout_request(uuid) from public;
grant execute on function public.cancel_checkout_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin L1+: items_good / approved / denied
-- ---------------------------------------------------------------------------
create or replace function public.set_checkout_request_status(
  p_request_id uuid,
  p_status text
)
returns public.checkout_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_uid uuid := auth.uid();
  next_status text := lower(trim(coalesce(p_status, '')));
  row public.checkout_requests;
begin
  if admin_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_admin_at_least(1) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request id is required';
  end if;
  if next_status not in ('items_good', 'approved', 'denied') then
    raise exception 'Invalid status';
  end if;

  perform public.expire_stale_checkout_requests();

  select * into row
  from public.checkout_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Checkout request not found';
  end if;

  if row.status not in ('pending', 'items_good') then
    raise exception 'Checkout request is no longer open';
  end if;

  if next_status = 'items_good' then
    if row.status <> 'pending' then
      raise exception 'Items already marked good';
    end if;
    update public.checkout_requests
    set
      status = 'items_good',
      reviewed_by = admin_uid,
      reviewed_at = now()
    where id = p_request_id
    returning * into row;
    return row;
  end if;

  if next_status = 'approved' then
    if row.status <> 'items_good' then
      raise exception 'Mark items good before approving';
    end if;
    update public.checkout_requests
    set
      status = 'approved',
      reviewed_by = coalesce(row.reviewed_by, admin_uid),
      reviewed_at = coalesce(row.reviewed_at, now()),
      resolved_at = now()
    where id = p_request_id
    returning * into row;
    return row;
  end if;

  -- denied
  update public.checkout_requests
  set
    status = 'denied',
    reviewed_by = coalesce(row.reviewed_by, admin_uid),
    reviewed_at = coalesce(row.reviewed_at, now()),
    resolved_at = now()
  where id = p_request_id
  returning * into row;

  return row;
end;
$$;

revoke all on function public.set_checkout_request_status(uuid, text) from public;
grant execute on function public.set_checkout_request_status(uuid, text) to authenticated;
