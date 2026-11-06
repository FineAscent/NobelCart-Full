// Supabase Edge Function: send-checkout-email
// Expects JSON body: { user_id, receipt_id, user_email, items, total_cents, currency }
// Sends a receipt email with checkout details to user

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { sendBrevoEmail } from "../_shared/auth.ts";
import { receiptEmailHtml } from "../_shared/receipt-email.mjs";

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function badRequest(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { "content-type": "application/json", ...corsHeaders } });
}

function successResponse(data: any) {
  return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json", ...corsHeaders } });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return badRequest("Method not allowed", 405);

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const { user_email, items, total_cents, currency = "USD", receipt_id } = body;

  if (!user_email) return badRequest("Missing user_email");
  if (!items || !Array.isArray(items)) return badRequest("Missing or invalid items array");
  if (total_cents === undefined || total_cents === null) return badRequest("Missing total_cents");

  // Idempotency Check
  if (receipt_id && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: receipt } = await supabase
        .from('receipts')
        .select('email_sent')
        .eq('id', receipt_id)
        .single();
      
      if (receipt && receipt.email_sent) {
        console.log(`Email already sent for receipt ${receipt_id}. Skipping.`);
        return successResponse({ ok: true, message: "Email already sent", skipped: true });
      }
    } catch (e) {
      console.warn("Idempotency check failed (proceeding anyway):", e);
    }
  }

  const htmlBody = receiptEmailHtml({
    items, totalCents: total_cents, currency, receiptId: receipt_id,
    timestamp: new Date().toLocaleString(),
  });

  // Use the same Brevo sender as verification emails.
  if (BREVO_API_KEY) {
    try {
      const emailData = await sendBrevoEmail({
        email: user_email,
        subject: `Receipt Confirmation - Order #${receipt_id || ""}`,
        htmlContent: htmlBody,
      });

      // Mark as sent in DB
      if (receipt_id && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
          await supabase.from('receipts').update({ email_sent: true }).eq('id', receipt_id);
        } catch (_) {}
      }

      return successResponse({
        ok: true,
        message: "Receipt email sent successfully",
        email_sent: true,
        email_id: emailData.messageId,
      });
    } catch (e) {
      console.error("Email send error:", e);
      return successResponse({
        ok: true,
        message: "Receipt saved (email sending encountered an error)",
        email_sent: false,
        error: String(e),
      });
    }
  } else {
    // An unconfigured provider must not mark the receipt as emailed.
    console.log(
      `Email would be sent to ${user_email} for receipt ${receipt_id} (BREVO_API_KEY not configured)`
    );
    return successResponse({
      ok: true,
      message: "Receipt saved (email service not configured)",
      email_sent: false,
    });
  }
});
