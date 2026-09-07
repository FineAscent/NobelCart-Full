// cleanup-unverified-users: delete auth users with phone_verified=false older than 24h.
// Prefer calling SQL public.cleanup_unverified_users() via pg_cron.
// This edge function is a manual/ops fallback (service role or cron secret).

// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { adminClient, bad, corsHeaders, json } from "../_shared/auth.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return bad("Method not allowed", 405);

  const cronSecret = Deno.env.get("CLEANUP_CRON_SECRET") || "";
  const headerSecret = req.headers.get("x-cron-secret") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  const okCron = cronSecret && headerSecret && headerSecret === cronSecret;
  const okService = serviceKey && authHeader === `Bearer ${serviceKey}`;
  if (!okCron && !okService) {
    return bad("Unauthorized", 401);
  }

  const admin = adminClient();
  const { data, error } = await admin.rpc("cleanup_unverified_users");
  if (error) {
    // Fallback: delete via admin API if RPC missing
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error: qErr } = await admin
      .from("profiles")
      .select("id")
      .eq("phone_verified", false)
      .eq("is_admin", false)
      .lt("created_at", cutoff);

    if (qErr) return bad(error.message || qErr.message, 500);

    let deleted = 0;
    for (const row of rows || []) {
      const { error: delErr } = await admin.auth.admin.deleteUser(row.id);
      if (!delErr) deleted++;
    }
    return json({ ok: true, deleted, via: "admin_api" });
  }

  return json({ ok: true, deleted: data ?? 0, via: "rpc" });
});
