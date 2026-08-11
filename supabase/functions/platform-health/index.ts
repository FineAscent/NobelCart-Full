// Supabase Edge Function: platform-health
// Admin-only. Probes Stripe, Supabase, AWS API Gateway, GitHub, and Brevo
// so the admin UI can show Active / Degraded / Down / Not configured.
//
// Auth: Bearer <user JWT> — caller must have profiles.is_admin = true.
// Optional body: { api_base?: string }  // AWS API Gateway base from config.js

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
// @ts-ignore
const STRIPE_SECRET_KEY: string = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
// @ts-ignore
const BREVO_API_KEY: string = Deno.env.get("BREVO_API_KEY") ?? "";
// @ts-ignore
const RESEND_API_KEY: string = Deno.env.get("RESEND_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type State = "ok" | "degraded" | "down" | "unconfigured";

interface CheckResult {
  id: string;
  name: string;
  state: State;
  latency_ms: number | null;
  detail: string;
  status_page?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

async function timedFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<{ res: Response | null; ms: number; error: string | null }> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { res, ms: Date.now() - start, error: null };
  } catch (e: any) {
    return { res: null, ms: Date.now() - start, error: e?.message || String(e) };
  }
}

function indicatorToState(indicator: string | undefined): State {
  const i = (indicator || "").toLowerCase();
  if (!i || i === "none" || i === "operational") return "ok";
  if (i === "minor") return "degraded";
  return "down";
}

async function checkStatusPage(url: string): Promise<{ state: State; detail: string; ms: number }> {
  const { res, ms, error } = await timedFetch(url);
  if (error || !res) return { state: "down", detail: error || "No response", ms };
  try {
    const data = await res.json();
    const indicator = data?.status?.indicator;
    const description = data?.status?.description || "Unknown";
    return { state: indicatorToState(indicator), detail: description, ms };
  } catch {
    return { state: res.ok ? "degraded" : "down", detail: `HTTP ${res.status}`, ms };
  }
}

async function checkSupabase(): Promise<CheckResult> {
  const statusPage = "https://status.supabase.com";
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return {
      id: "supabase",
      name: "Supabase",
      state: "unconfigured",
      latency_ms: null,
      detail: "SUPABASE_URL / service role missing in function env",
      status_page: statusPage,
    };
  }

  const start = Date.now();
  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await admin.from("profiles").select("id").limit(1);
    const ms = Date.now() - start;
    if (error) {
      return {
        id: "supabase",
        name: "Supabase",
        state: "down",
        latency_ms: ms,
        detail: error.message || "Query failed",
        status_page: statusPage,
      };
    }
    const pub = await checkStatusPage("https://status.supabase.com/api/v2/status.json");
    if (pub.state !== "ok") {
      return {
        id: "supabase",
        name: "Supabase",
        state: "degraded",
        latency_ms: ms,
        detail: `Our project responds, but status page says: ${pub.detail}`,
        status_page: statusPage,
      };
    }
    return {
      id: "supabase",
      name: "Supabase",
      state: "ok",
      latency_ms: ms,
      detail: `Auth + DB reachable (${ms}ms)`,
      status_page: statusPage,
    };
  } catch (e: any) {
    return {
      id: "supabase",
      name: "Supabase",
      state: "down",
      latency_ms: Date.now() - start,
      detail: e?.message || String(e),
      status_page: statusPage,
    };
  }
}

async function checkStripe(): Promise<CheckResult> {
  const statusPage = "https://status.stripe.com";
  if (!STRIPE_SECRET_KEY) {
    return {
      id: "stripe",
      name: "Stripe",
      state: "unconfigured",
      latency_ms: null,
      detail: "STRIPE_SECRET_KEY not set",
      status_page: statusPage,
    };
  }

  const { res, ms, error } = await timedFetch("https://api.stripe.com/v1/balance", {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });

  if (error || !res) {
    return {
      id: "stripe",
      name: "Stripe",
      state: "down",
      latency_ms: ms,
      detail: error || "No response from Stripe API",
      status_page: statusPage,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      id: "stripe",
      name: "Stripe",
      state: "down",
      latency_ms: ms,
      detail: `API key rejected (HTTP ${res.status}) — check STRIPE_SECRET_KEY`,
      status_page: statusPage,
    };
  }

  if (!res.ok) {
    return {
      id: "stripe",
      name: "Stripe",
      state: "degraded",
      latency_ms: ms,
      detail: `Unexpected HTTP ${res.status}`,
      status_page: statusPage,
    };
  }

  return {
    id: "stripe",
    name: "Stripe",
    state: "ok",
    latency_ms: ms,
    detail: `API authenticated (${ms}ms)`,
    status_page: statusPage,
  };
}

async function checkAws(apiBase: string): Promise<CheckResult> {
  const statusPage = "https://health.aws.amazon.com/health/status";
  if (!apiBase) {
    return {
      id: "aws",
      name: "AWS",
      state: "unconfigured",
      latency_ms: null,
      detail: "No API Gateway base URL provided",
      status_page: statusPage,
    };
  }

  const url = apiBase.replace(/\/$/, "") + "/";
  const { res, ms, error } = await timedFetch(url, { method: "GET" });

  // API Gateway often returns 403/404 without a route — that still means AWS is up.
  if (error || !res) {
    return {
      id: "aws",
      name: "AWS",
      state: "down",
      latency_ms: ms,
      detail: error || `Cannot reach ${apiBase}`,
      status_page: statusPage,
    };
  }

  if (res.status >= 500) {
    return {
      id: "aws",
      name: "AWS",
      state: "down",
      latency_ms: ms,
      detail: `API Gateway HTTP ${res.status}`,
      status_page: statusPage,
    };
  }

  return {
    id: "aws",
    name: "AWS",
    state: "ok",
    latency_ms: ms,
    detail: `API Gateway reachable (HTTP ${res.status}, ${ms}ms)`,
    status_page: statusPage,
  };
}

async function checkGithub(): Promise<CheckResult> {
  const statusPage = "https://www.githubstatus.com";
  const pub = await checkStatusPage("https://www.githubstatus.com/api/v2/status.json");
  return {
    id: "github",
    name: "GitHub",
    state: pub.state,
    latency_ms: pub.ms,
    detail: pub.detail,
    status_page: statusPage,
  };
}

async function checkBrevo(): Promise<CheckResult> {
  const statusPage = "https://status.brevo.com";

  // This checkout email path currently uses Resend; Brevo may be used elsewhere.
  // Prefer Brevo when configured; otherwise probe Resend so email health is still visible.
  if (BREVO_API_KEY) {
    const { res, ms, error } = await timedFetch("https://api.brevo.com/v3/account", {
      headers: { "api-key": BREVO_API_KEY, accept: "application/json" },
    });
    if (error || !res) {
      return {
        id: "brevo",
        name: "Brevo",
        state: "down",
        latency_ms: ms,
        detail: error || "No response from Brevo API",
        status_page: statusPage,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        id: "brevo",
        name: "Brevo",
        state: "down",
        latency_ms: ms,
        detail: `API key rejected (HTTP ${res.status})`,
        status_page: statusPage,
      };
    }
    if (!res.ok) {
      return {
        id: "brevo",
        name: "Brevo",
        state: "degraded",
        latency_ms: ms,
        detail: `Unexpected HTTP ${res.status}`,
        status_page: statusPage,
      };
    }
    return {
      id: "brevo",
      name: "Brevo",
      state: "ok",
      latency_ms: ms,
      detail: `Account API reachable (${ms}ms)`,
      status_page: statusPage,
    };
  }

  if (RESEND_API_KEY) {
    const { res, ms, error } = await timedFetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    });
    if (error || !res) {
      return {
        id: "brevo",
        name: "Email (Resend)",
        state: "down",
        latency_ms: ms,
        detail: `Brevo not configured; Resend probe failed: ${error || "no response"}`,
        status_page: "https://resend.com",
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        id: "brevo",
        name: "Email (Resend)",
        state: "down",
        latency_ms: ms,
        detail: "Brevo not set; Resend API key rejected",
        status_page: "https://resend.com",
      };
    }
    if (!res.ok) {
      return {
        id: "brevo",
        name: "Email (Resend)",
        state: "degraded",
        latency_ms: ms,
        detail: `Brevo not set; Resend HTTP ${res.status}`,
        status_page: "https://resend.com",
      };
    }
    return {
      id: "brevo",
      name: "Email (Resend)",
      state: "ok",
      latency_ms: ms,
      detail: `BREVO_API_KEY not set; Resend is configured and reachable (${ms}ms)`,
      status_page: "https://resend.com",
    };
  }

  return {
    id: "brevo",
    name: "Brevo",
    state: "unconfigured",
    latency_ms: null,
    detail: "BREVO_API_KEY not set (and no RESEND_API_KEY fallback)",
    status_page: statusPage,
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);

  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: prof } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    if (!prof?.is_admin) return json({ error: "Admin access required" }, 403);

    let apiBase = "";
    try {
      const body = await req.json();
      apiBase = String(body?.api_base || "").trim();
    } catch (_) { }

    const platforms = await Promise.all([
      checkStripe(),
      checkSupabase(),
      checkAws(apiBase),
      checkGithub(),
      checkBrevo(),
    ]);

    const worst = platforms.reduce<State>((acc, p) => {
      const rank = { down: 3, unconfigured: 2, degraded: 1, ok: 0 } as const;
      return rank[p.state] > rank[acc] ? p.state : acc;
    }, "ok");

    return json({
      ok: worst === "ok" || worst === "degraded",
      overall: worst,
      checked_at: new Date().toISOString(),
      platforms,
    });
  } catch (e: any) {
    return json({ error: e?.message || "Internal error" }, 500);
  }
});
