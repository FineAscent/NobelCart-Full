-- QR sign-in: one pending session per cart, readable approvals, one active user per cart.

-- Kiosk can still read approved rows briefly after expires_at (consume token_hash).
drop policy if exists "qr_sessions_select_anon" on public.cart_qr_sessions;
create policy "qr_sessions_select_anon" on public.cart_qr_sessions
  for select to anon
  using (
    expires_at > now()
    or (status = 'approved' and token_hash is not null)
  );

-- Replace ad-hoc kiosk inserts: expire stale pending rows, then create one fresh session.
create or replace function public.start_cart_qr_session(p_cart_id text)
returns table(id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_exp timestamptz := now() + interval '6 minutes';
begin
  if p_cart_id is null or length(trim(p_cart_id)) = 0 then
    raise exception 'cart_id is required';
  end if;

  update public.cart_qr_sessions
  set status = 'expired'
  where cart_id = trim(p_cart_id)
    and status = 'pending';

  insert into public.cart_qr_sessions (cart_id, status, expires_at)
  values (trim(p_cart_id), 'pending', v_exp)
  returning cart_qr_sessions.id, cart_qr_sessions.expires_at into v_id, v_exp;

  return query select v_id, v_exp;
end;
$$;

revoke all on function public.start_cart_qr_session(text) from public;
grant execute on function public.start_cart_qr_session(text) to anon, authenticated;

comment on function public.start_cart_qr_session(text) is
  'Kiosk: expire old pending QR sessions for this cart and open one new pending session.';

-- Bind cart to the signed-in shopper; force-sign-out anyone else on this cart.
create or replace function public.claim_cart_user(p_cart_id text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  prev uuid;
begin
  if p_cart_id is null or length(trim(p_cart_id)) = 0 or p_user_id is null then
    return;
  end if;

  select user_id into prev
  from public.carts
  where cart_id = trim(p_cart_id)
  for update;

  if prev is not null and prev <> p_user_id then
    update public.active_sessions
    set force_sign_out = true
    where user_id = prev
      and cart_id = trim(p_cart_id);
  end if;

  update public.active_sessions
  set force_sign_out = true
  where cart_id = trim(p_cart_id)
    and user_id is distinct from p_user_id;

  insert into public.carts (cart_id, user_id)
  values (trim(p_cart_id), p_user_id)
  on conflict (cart_id) do update
    set user_id = excluded.user_id;
end;
$$;

revoke all on function public.claim_cart_user(text, uuid) from public;
grant execute on function public.claim_cart_user(text, uuid) to authenticated;

comment on function public.claim_cart_user(text, uuid) is
  'Assign cart to shopper and force-sign-out any other active session on that cart.';
