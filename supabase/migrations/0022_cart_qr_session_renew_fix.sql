-- Do not expire in-flight pending QR sessions before their expires_at.
-- Only rotate sessions that are naturally stale (past expires_at or older than 5 min).

create or replace function public.start_cart_qr_session(p_cart_id text)
returns table(id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_exp timestamptz;
begin
  if p_cart_id is null or length(trim(p_cart_id)) = 0 then
    raise exception 'cart_id is required';
  end if;

  update public.cart_qr_sessions
  set status = 'expired'
  where cart_id = trim(p_cart_id)
    and status = 'pending'
    and (
      expires_at <= now()
      or created_at <= now() - interval '5 minutes'
    );

  select s.id, s.expires_at
  into v_id, v_exp
  from public.cart_qr_sessions s
  where s.cart_id = trim(p_cart_id)
    and s.status = 'pending'
    and s.expires_at > now()
  order by s.created_at desc
  limit 1;

  if v_id is not null then
    return query select v_id, v_exp;
    return;
  end if;

  insert into public.cart_qr_sessions (cart_id, status, expires_at)
  values (trim(p_cart_id), 'pending', now() + interval '6 minutes')
  returning cart_qr_sessions.id, cart_qr_sessions.expires_at into v_id, v_exp;

  return query select v_id, v_exp;
end;
$$;
