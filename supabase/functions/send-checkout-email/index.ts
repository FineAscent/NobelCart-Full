// Supabase Edge Function: send-checkout-email
// Expects JSON body: { user_id, receipt_id, user_email, items, total_cents, currency }
// Sends a receipt email with checkout details to user

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { accountSmsAllowed, sendBrevoEmail, sendBrevoSms, smsReady } from "../_shared/auth.ts";

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

function formatMoney(cents: number, currency: string = "USD"): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
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

  // SMS preference is read from verified server records, never from the request.
  // Only the receipt owner (or our webhook service role) can trigger its SMS.
  if (receipt_id && body.user_id && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    let allowed = token === SUPABASE_SERVICE_ROLE_KEY;
    if (!allowed && token) {
      const { data, error } = await admin.auth.getUser(token);
      allowed = !error && data?.user?.id === body.user_id;
    }
    if (!allowed) return badRequest('Not authorized to send this receipt.', 403);
    const { data: receipt, error: receiptError } = await admin.from('receipts')
      .select('id, user_id, amount_total_cents, currency, email_sent, sms_sent_at')
      .eq('id', receipt_id).eq('user_id', body.user_id).maybeSingle();
    if (!receiptError && !receipt) return badRequest('Receipt not found.', 404);
    if (receipt?.sms_sent_at || receipt?.email_sent) {
      return successResponse({ ok: true, skipped: true,
        channel: receipt.sms_sent_at ? 'sms' : 'email', message: 'Receipt notification already sent' });
    }
    if (receipt && smsReady()) {
      const { data: profile } = await admin.from('profiles').select('phone').eq('id', body.user_id).maybeSingle();
      if (profile?.phone && await accountSmsAllowed(admin, body.user_id, profile.phone, 'order')) {
        const claimTime = new Date().toISOString();
        const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: claim, error: claimError } = await admin.from('receipts')
          .update({ sms_sending_at: claimTime }).eq('id', receipt_id).is('sms_sent_at', null)
          .or(`sms_sending_at.is.null,sms_sending_at.lt.${stale}`).select('id');
        if (!claimError && !claim?.length) {
          return successResponse({ ok: true, skipped: true, message: 'Receipt notification already in progress' });
        }
        if (!claimError) {
          try {
            const total = formatMoney(receipt.amount_total_cents, receipt.currency);
            await sendBrevoSms(profile.phone, `NobleCart: Payment received: ${total}. Receipt ${receipt_id}. Your detailed receipt is in the NobleCart app. Reply STOP to cancel or HELP for help.`);
            const { error: saveError } = await admin.from('receipts')
              .update({ sms_sent_at: new Date().toISOString(), sms_sending_at: null }).eq('id', receipt_id);
            if (saveError) console.error('SMS sent but receipt tracking failed', saveError);
            return successResponse({ ok: true, channel: 'sms', sms_sent: true, email_sent: false });
          } catch (e) {
            await admin.from('receipts').update({ sms_sending_at: null }).eq('id', receipt_id);
            console.warn('Receipt SMS unavailable; falling back to email.', e);
          }
        }
      }
    }
  }

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
