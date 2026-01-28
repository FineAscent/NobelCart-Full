// Supabase Edge Function: stripe-session-details
// Expects JSON body: { session_id }
// Returns: { id, currency, amount_total_cents, amount_subtotal_cents?, items: [{ name, quantity, amount_cents }] }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return badRequest("Method not allowed", 405);
  if (!STRIPE_SECRET_KEY) return badRequest("Stripe not configured", 500);

  let body: { session_id?: string } | null = null;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body"); }
  const session_id = String(body?.session_id || "").trim();
  if (!session_id) return badRequest("Missing session_id");

  // Retrieve session with line items
  const res = await fetch(`${STRIPE_API}/checkout/sessions/${encodeURIComponent(session_id)}?expand[]=line_items`, {
    headers: { "authorization": `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return badRequest(`Stripe error: ${res.status} ${text}`, 502);
  }
  const s = await res.json();

  const currency: string = (s?.currency || "usd").toUpperCase();
  const total_cents: number = Number(s?.amount_total ?? 0) || 0;
  const subtotal_cents: number | null = s?.amount_subtotal != null ? (Number(s.amount_subtotal) || 0) : null;

  const items = Array.isArray(s?.line_items?.data) ? s.line_items.data.map((li: any) => {
    const name = li?.description || li?.price?.product?.name || li?.price?.nickname || "Item";
    const qty = Number(li?.quantity ?? 1) || 1;
    const unit_amount = Number(li?.price?.unit_amount ?? 0) || 0;
    const product_id = li?.price?.product?.metadata?.id ?? null;
    return { name, quantity: qty, amount_cents: unit_amount, product_id };
  }) : [];

  const out = {
    id: s?.id || session_id,
    currency,
    amount_total_cents: total_cents,
    amount_subtotal_cents: subtotal_cents ?? undefined,
    items,
  };

  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json", ...corsHeaders } });
});
