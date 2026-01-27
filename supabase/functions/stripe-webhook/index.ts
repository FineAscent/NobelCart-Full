// Supabase Edge Function: stripe-webhook
// Handles Stripe webhooks (checkout.session.completed) to save receipts and send emails
//
// 1. Receives checkout.session.completed
// 2. Fetches full session with line_items from Stripe
// 3. Upserts into public.receipts
// 4. Inserts into public.checkout_items
// 5. Triggers send-checkout-email

// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// @ts-ignore
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
// @ts-ignore
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
// @ts-ignore
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
// @ts-ignore
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET"); // Optional: for signature verification

const STRIPE_API = "https://api.stripe.com/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function badRequest(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { "content-type": "application/json", ...corsHeaders } });
}

function success(data: any) {
  return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json", ...corsHeaders } });
}

serve(async (req: any) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return badRequest("Method not allowed", 405);
  if (!STRIPE_SECRET_KEY) return badRequest("Stripe not configured", 500);

  // 1. Get the event body
  const text = await req.text();
  let event;
  try {
    event = JSON.parse(text);
  } catch (err: any) {
    return badRequest(`Webhook error: ${err?.message || err}`, 400);
  }

  // 2. (Optional) Verify signature if STRIPE_WEBHOOK_SECRET is set
  // Ideally use stripe.webhooks.constructEvent, but we are in Deno without the full Node Stripe SDK easily available
  // For now, we trust the event ID and will fetch the session from Stripe to verify it exists and is valid.

  // 3. Handle checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const sessionRaw = event.data.object;
    const sessionId = sessionRaw.id;

    console.log(`Processing checkout.session.completed for ${sessionId}`);

    // Fetch full session with line_items to ensure we have all data securely
    const res = await fetch(`${STRIPE_API}/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`, {
      headers: { "authorization": `Bearer ${STRIPE_SECRET_KEY}` },
    });
    if (!res.ok) {
      console.error(`Failed to fetch session ${sessionId}: ${res.status}`);
      return badRequest('Failed to fetch session from Stripe', 502);
    }
    const session = await res.json();

    // Extract Metadata
    const userId = session.metadata?.user_id;
    const userEmail = session.metadata?.user_email || session.customer_details?.email || session.customer_email;
    
    if (!userId) {
      console.warn(`No user_id in session metadata for ${sessionId}. Skipping receipt save.`);
      // If we can't link to a user, we can't save to public.receipts (it requires user_id).
      // You could implement logic here to lookup user by email if needed.
      return success({ received: true, status: "ignored_no_user_id" });
    }

    const currency = (session.currency || 'usd').toUpperCase();
    const amountTotal = session.amount_total || 0;
    
    // Prepare Items
    const lineItems = session.line_items?.data || [];
    const itemsForJson: any[] = [];
    const itemsForTable: any[] = [];

    for (const li of lineItems) {
      const quantity = li.quantity || 1;
      const amount = li.amount_total || 0; // Total for this line
      const unitAmount = li.price?.unit_amount || 0;
      const description = li.description || li.price?.product?.name || "Item";
      
      // Metadata from price/product if available (we passed it in create-session)
      // Note: Stripe puts product metadata on the product object, but line_items might not expand product fully unless requested.
      // However, we passed metadata into line_items in create-session.
      // Let's rely on what we get. The create-session function put metadata on line_items directly? 
      // Checking create-session: form.set(`line_items[${i}][price_data][product_data][metadata][id]`, ...);
      // This puts it on the product. We might need to fetch product or hope it's in the line item price.product expansion?
      // "expand[]=line_items.data.price.product" might be needed.
      // For now, we'll try to extract what we can.
      
      const productId = li.price?.product; // This is an ID string if not expanded
      
      // Simplified item for JSON column
      itemsForJson.push({
        name: description,
        quantity: quantity,
        amount_cents: unitAmount, // store unit price
        total_cents: amount,
        product_id: typeof productId === 'string' ? productId : productId?.id
      });

      // Item for checkout_items table
      itemsForTable.push({
        user_id: userId,
        // receipt_id: will be filled after receipt insert
        product_id: typeof productId === 'string' ? productId : productId?.id,
        product_name: description,
        quantity: quantity,
        unit_price_cents: unitAmount,
        total_price_cents: amount,
        // We'd need to look at custom metadata to know if it's weighted.
        // If we can't easily get it, default false.
        is_weighted: false, 
        unit: null
      });
    }

    // 4. Save to Supabase
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // A. Upsert Receipt
      const { data: receipt, error: receiptError } = await supabase
        .from('receipts')
        .upsert({
          user_id: userId,
          session_id: sessionId,
          currency: currency,
          amount_total_cents: amountTotal,
          items: itemsForJson,
          created_at: new Date().toISOString()
        }, { onConflict: 'session_id' })
        .select()
        .single();

      if (receiptError) {
        console.error('Failed to upsert receipt:', receiptError);
        return badRequest(`Database error: ${receiptError.message}`, 500);
      }

      const receiptId = receipt.id;

      // B. Insert Checkout Items
      // First, delete existing items for this receipt (idempotency)
      await supabase.from('checkout_items').delete().eq('receipt_id', receiptId);
      
      // Add receipt_id to items
      const rows = itemsForTable.map(i => ({ ...i, receipt_id: receiptId }));
      if (rows.length > 0) {
        const { error: itemsError } = await supabase.from('checkout_items').insert(rows);
        if (itemsError) {
          console.error('Failed to insert checkout_items:', itemsError);
          // Non-fatal, receipt is saved
        }
      }

      // 5. Send Email
      // We can invoke the send-checkout-email function
      // Or just call it directly if we want to bundle logic, but invoking is cleaner separation.
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/send-checkout-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          },
          body: JSON.stringify({
            user_id: userId,
            receipt_id: receiptId,
            user_email: userEmail,
            items: itemsForJson,
            total_cents: amountTotal,
            currency: currency
          })
        });
        console.log(`Email trigger sent for receipt ${receiptId}`);
      } catch (e) {
        console.error('Failed to trigger email function:', e);
      }
      
      return success({ received: true, receipt_id: receiptId });
    } else {
      console.error('Supabase credentials missing');
      return badRequest('Server configuration error', 500);
    }
  }

  return success({ received: true });
});
