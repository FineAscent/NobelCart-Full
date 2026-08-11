// Supabase Edge Function: report-error
// Step 2 of the kiosk error tracker.
//
// Signed-in members only. Inserts a row into public.client_errors with the
// caller's user_id (never taken from the body). Rate-limited so a tight
// error loop cannot flood the table.
//
// Auth: Bearer <user JWT>
// Body: {
//   page: string,                 // required — pathname or page name
//   message: string,              // required
//   stack?: string,
//   source?: 'js'|'supabase'|'stripe'|'network'|'other',
//   severity?: 'error'|'warn',
//   cart_id?: string
// }

// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// @ts-ignore
const SUPABASE_URL: string = Deno.env.get("SUPABASE_URL") ?? "";
// @ts-ignore
const SUPABASE_ANON_KEY: string = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
// @ts-ignore
const SUPABASE_SERVICE_ROLE_KEY: string = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SOURCES = new Set(["js", "supabase", "stripe", "network", "other"]);
const SEVERITIES = new Set(["error", "warn"]);

// Soft cap: enough for real failures, low enough to stop a runaway loop.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 5 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function clip(value: unknown, max: number): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

/** Drop obvious secrets if a stack/message ever includes them. */
function scrub(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, "[jwt-redacted]")
    .replace(/(api[_-]?key|password|secret|token)\s*[:=]\s*["']?[^"'\s]+/gi, "$1=[redacted]");
}

function fingerprint(page: string, message: string, source: string): string {
  const raw = `${source}|${page}|${message}`.toLowerCase().slice(0, 300);
  // Lightweight non-crypto hash — good enough for grouping later.
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Missing authorization" }, 401);
  }

  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json({ error: "Unauthorized — sign in required" }, 401);
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be JSON" }, 400);
    }

    const page = clip(body.page, 200);
    const message = scrub(clip(body.message, 1000));
    if (!page || !message) {
      return json({ error: "page and message are required" }, 400);
    }

    const sourceRaw = clip(body.source, 32).toLowerCase() || "js";
    const source = SOURCES.has(sourceRaw) ? sourceRaw : "other";
    const severityRaw = clip(body.severity, 16).toLowerCase() || "error";
    const severity = SEVERITIES.has(severityRaw) ? severityRaw : "error";
    const stack = scrub(clip(body.stack, 4000)) || null;
    const cartId = clip(body.cart_id, 120) || null;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Rate limit: count this user's recent rows (service role — members cannot SELECT).
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count, error: countErr } = await admin
      .from("client_errors")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", since);

    if (countErr) {
      return json({ error: "Rate limit check failed", detail: countErr.message }, 502);
    }
    if ((count ?? 0) >= RATE_LIMIT) {
      // Soft success so the kiosk does not retry-spam on 429.
      return json({
        ok: true,
        accepted: false,
        reason: "rate_limited",
        limit: RATE_LIMIT,
        window_minutes: RATE_WINDOW_MS / 60000,
      });
    }

    const row = {
      user_id: user.id,
      cart_id: cartId,
      page,
      source,
      message,
      stack,
      severity,
      status: "new",
      fingerprint: fingerprint(page, message, source),
    };

    const { data, error: insertErr } = await admin
      .from("client_errors")
      .insert(row)
      .select("id, created_at")
      .single();

    if (insertErr) {
      return json({ error: "Insert failed", detail: insertErr.message }, 502);
    }

    return json({ ok: true, accepted: true, id: data.id, created_at: data.created_at });
  } catch (e: any) {
    return json({ error: e?.message || "Internal error" }, 500);
  }
});
