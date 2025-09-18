// Supabase Edge Function: refunds-for-sessions
// Input: { session_ids: string[] }
// Output: { refunds: Array<{ id: string, amount_cents: number, currency: string, created: number, session_id: string }> }
// Notes: For each Checkout Session, we resolve its payment_intent and then list Stripe refunds for that intent.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_API = "https://api.stripe.com/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...corsHeaders } });
}

function badRequest(msg: string, status = 400) {
  return json({ error: msg }, status);
}

async function fetchJSON(url: string) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${STRIPE_SECRET_KEY}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => '')}`);
  return await res.json();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return badRequest('Method not allowed', 405);
  if (!STRIPE_SECRET_KEY) return badRequest('Stripe not configured', 500);

  let body: { session_ids?: string[] } | null = null;
  try { body = await req.json(); } catch { return badRequest('Invalid JSON'); }
  const session_ids = Array.isArray(body?.session_ids) ? body!.session_ids!.map(String).filter(Boolean) : [];
  if (!session_ids.length) return badRequest('session_ids required');

  // Resolve each session's payment_intent
  const out: { refunds: Array<{ id: string, amount_cents: number, currency: string, created: number, session_id: string }> } = { refunds: [] };

  for (const sid of session_ids) {
    try {
      const s = await fetchJSON(`${STRIPE_API}/checkout/sessions/${encodeURIComponent(sid)}`);
      const pi = s?.payment_intent;
      const currency = (s?.currency || 'usd').toUpperCase();
      if (!pi) continue;
      const list = await fetchJSON(`${STRIPE_API}/refunds?payment_intent=${encodeURIComponent(pi)}`);
      const data = Array.isArray(list?.data) ? list.data : [];
      for (const r of data) {
        out.refunds.push({
          id: r?.id,
          amount_cents: Number(r?.amount ?? 0) || 0,
          currency,
          created: Number(r?.created ?? 0) || 0,
          session_id: sid,
        });
      }
    } catch (e) {
      // continue others
    }
  }

  return json(out);
});
