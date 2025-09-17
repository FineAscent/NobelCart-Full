// Supabase Edge Function: stripe-create-session
// Expects JSON body: { currency, items: [{ name, quantity, amount_cents, metadata? }], success_url, cancel_url, customer_hint }
// Returns: { id, url }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

interface LineItemIn {
  name: string;
  quantity: number; // integer for standard items, 1 for weighted
  amount_cents: number; // unit amount in cents (or total for weighted)
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

interface CreatePayload {
  currency?: string;
  items: LineItemIn[];
  success_url: string;
  cancel_url: string;
  customer_hint?: { user_id?: string | null; user_email?: string | null };
}

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_API = "https://api.stripe.com/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function badRequest(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { "content-type": "application/json", ...corsHeaders } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return badRequest("Method not allowed", 405);
  if (!STRIPE_SECRET_KEY) return badRequest("Stripe not configured", 500);

  let payload: CreatePayload | null = null;
  try {
    payload = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const currency = (payload?.currency || "usd").toLowerCase();
  const items = Array.isArray(payload?.items) ? payload!.items : [];
  const success_url = String(payload?.success_url || "");
  const cancel_url = String(payload?.cancel_url || "");
  if (!success_url || !cancel_url || items.length === 0) {
    return badRequest("Missing success_url/cancel_url/items");
  }

  // Transform items into Stripe line_items with price_data
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", success_url);
  form.set("cancel_url", cancel_url);

  const meta: Record<string, string> = {};
  if (payload?.customer_hint?.user_id) meta["user_id"] = String(payload.customer_hint.user_id);
  if (payload?.customer_hint?.user_email) meta["user_email"] = String(payload.customer_hint.user_email);
  // Include a compact items summary in metadata (avoid exceeding limits)
  try {
    const summary = items.slice(0, 20).map(i => `${i.name}:${i.quantity}x${i.amount_cents}`).join("|");
    if (summary) meta["items"] = summary;
  } catch {}
  Object.entries(meta).forEach(([k, v], i) => {
    form.set(`metadata[${k}]`, v);
  });

  items.forEach((it, idx) => {
    const i = String(idx);
    const qty = Math.max(1, Math.round(Number(it.quantity) || 1));
    const unit = Math.max(0, Math.round(Number(it.amount_cents) || 0));
    form.set(`line_items[${i}][quantity]`, String(qty));
    form.set(`line_items[${i}][price_data][currency]`, currency);
    form.set(`line_items[${i}][price_data][unit_amount]`, String(unit));
    form.set(`line_items[${i}][price_data][product_data][name]`, it.name || "Item");
    // Carry through our internal product id via product metadata if present
    const pid = it?.metadata && (it.metadata as any).id;
    if (pid != null) {
      form.set(`line_items[${i}][price_data][product_data][metadata][id]`, String(pid));
    }
  });

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return badRequest(`Stripe error: ${res.status} ${text}`, 502);
  }
  const data = await res.json();
  const out = { id: data?.id, url: data?.url };
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json", ...corsHeaders } });
});
