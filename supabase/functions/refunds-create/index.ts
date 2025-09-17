// Supabase Edge Function: refunds-create
// Expects JSON body: { transcript_no, item_index?, amount_cents? }
// If amount_cents is provided, refunds that amount. Otherwise, if item_index is provided, it refunds that line's total amount.
// Returns: { ok: boolean, message?: string }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_API = "https://api.stripe.com/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function badRequest(msg: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, message: msg }), { status, headers: { "content-type": "application/json", ...corsHeaders } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return badRequest("Method not allowed", 405);
  if (!STRIPE_SECRET_KEY) return badRequest("Stripe not configured", 500);

  let body: { transcript_no?: string; item_index?: number; amount_cents?: number } | null = null;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body"); }
  const transcript_no = String(body?.transcript_no || "").trim();
  if (!transcript_no) return badRequest("Missing transcript_no");

  // Retrieve session with line items to obtain payment_intent and amounts
  const sRes = await fetch(`${STRIPE_API}/checkout/sessions/${encodeURIComponent(transcript_no)}?expand[]=line_items`, {
    headers: { authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!sRes.ok) {
    const text = await sRes.text().catch(() => "");
    return badRequest(`Stripe error: ${sRes.status} ${text}`, 502);
  }
  const s = await sRes.json();
  const payment_intent = s?.payment_intent;
  if (!payment_intent) return badRequest("Payment intent not found for this session", 400);

  let amount = 0;
  if (typeof body?.amount_cents === "number" && body.amount_cents > 0) {
    amount = Math.floor(body.amount_cents);
  } else if (typeof body?.item_index === "number") {
    const idx = Math.max(0, Math.floor(body.item_index));
    const li = Array.isArray(s?.line_items?.data) ? s.line_items.data[idx] : null;
    if (!li) return badRequest("Item index not found for this receipt", 400);
    const qty = Number(li?.quantity ?? 1) || 1;
    const unit_amount = Number(li?.price?.unit_amount ?? 0) || 0;
    amount = Math.floor(qty * unit_amount);
  } else {
    return badRequest("Provide amount_cents or item_index to refund", 400);
  }
  if (!amount || amount <= 0) return badRequest("Invalid refund amount", 400);

  // Create refund
  const form = new URLSearchParams();
  form.set("payment_intent", String(payment_intent));
  form.set("amount", String(amount));
  form.set("reason", "requested_by_customer");
  // Include session id in metadata
  form.set("metadata[session_id]", transcript_no);

  const rRes = await fetch(`${STRIPE_API}/refunds`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  if (!rRes.ok) {
    const text = await rRes.text().catch(() => "");
    return badRequest(`Stripe refund error: ${rRes.status} ${text}`, 502);
  }
  const r = await rRes.json();

  return new Response(JSON.stringify({ ok: true, message: `Refund ${r?.id || ''} created for ${amount} cents.` }), { headers: { "content-type": "application/json", ...corsHeaders } });
});
