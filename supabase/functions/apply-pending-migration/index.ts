// One-shot: apply pending_signups migration. Invoke with service role, then delete this function.
// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  let role = "";
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    role = String(payload.role || "");
  } catch (_) {}
  if (role !== "service_role") {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
  }

  const dbUrl = Deno.env.get("SUPABASE_DB_URL") || Deno.env.get("DATABASE_URL") || "";
  if (!dbUrl) {
    return new Response(JSON.stringify({ error: "SUPABASE_DB_URL not set" }), { status: 500, headers: cors });
  }

  const sql = postgres(dbUrl, { prepare: false });
  try {
    await sql.unsafe(`
create table if not exists public.pending_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  phone text not null,
  full_name text not null,
  date_of_birth date not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists pending_signups_phone_unique on public.pending_signups (phone);
create unique index if not exists pending_signups_email_unique on public.pending_signups (email);
create index if not exists pending_signups_expires_at_idx on public.pending_signups (expires_at);
alter table public.pending_signups enable row level security;

create or replace function public.cleanup_pending_signups()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.pending_signups
  where expires_at < now() or created_at < now() - interval '1 hour';
  get diagnostics n = row_count;
  return n;
end; $$;

revoke all on function public.cleanup_pending_signups() from public;
grant execute on function public.cleanup_pending_signups() to service_role;

create or replace function public.cleanup_unverified_users()
returns integer language plpgsql security definer set search_path = public as $$
declare deleted_count integer := 0; r record;
begin
  perform public.cleanup_pending_signups();
  for r in
    select p.id from public.profiles p
    where coalesce(p.phone_verified, false) = false
      and coalesce(p.is_admin, false) = false
      and p.created_at < now() - interval '1 hour'
  loop
    delete from auth.users where id = r.id;
    deleted_count := deleted_count + 1;
  end loop;
  return deleted_count;
end; $$;
`);
    await sql.end();
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, "content-type": "application/json" },
    });
  } catch (e) {
    try { await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...cors, "content-type": "application/json" },
    });
  }
});
