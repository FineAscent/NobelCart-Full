// Supabase Edge Function: delete-account
// Called by an authenticated user who wants to permanently delete their own account.
// Auth: Bearer <user JWT>
// Optional body: { confirm: "DELETE" }  (recommended safety check)
// Effect: deletes the user from auth.users via the service role key.
//         All related tables (profiles, cabinet_items, receipts, checkout_items,
//         active_sessions) cascade-delete thanks to `on delete cascade` FKs.
//         cart_qr_sessions.user_id is set to null via `on delete set null`.

// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// @ts-ignore
const SUPABASE_URL: string = Deno.env.get("SUPABASE_URL") ?? "";
// @ts-ignore
const SUPABASE_SERVICE_ROLE_KEY: string = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// @ts-ignore
const SUPABASE_ANON_KEY: string = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(msg: string, status = 400, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({ error: msg, ...extra }),
    { status, headers: { "content-type": "application/json", ...corsHeaders } }
  );
}

serve(async (req: any) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json("Method not allowed", 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json("Missing authorization header", 401);
  }

  try {
    // Verify the calling user via their JWT
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json("Unauthorized", 401);
    }
    const userId = user.id;

    // Optional confirmation token check (recommended)
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch (_) {}
    const confirm = String(body?.confirm ?? "").trim();
    if (confirm && confirm !== "DELETE") {
      return json("Confirmation does not match. Type DELETE to confirm.", 400);
    }

    // Admin client — bypasses RLS and can delete auth users
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      return json(delErr.message || "Failed to delete user", 502);
    }

    return new Response(
      JSON.stringify({ ok: true, deleted: true }),
      { status: 200, headers: { "content-type": "application/json", ...corsHeaders } }
    );
  } catch (e: any) {
    return json(e?.message || "Internal error", 500);
  }
});
