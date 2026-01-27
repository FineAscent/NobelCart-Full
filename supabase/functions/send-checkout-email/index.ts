// Supabase Edge Function: send-checkout-email
// Expects JSON body: { user_id, receipt_id, user_email, items, total_cents, currency }
// Sends a receipt email with checkout details to user

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_API = "https://api.resend.com/emails";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "noreply@nobelcart.com";
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

serve(async (req) => {
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

  // Build email HTML
  const itemsHtml = items
    .map((item: any) => {
      const qty = Number(item.quantity || item.qty || 1) || 1;
      const unitPrice = formatMoney(Number(item.unit_price_cents || item.amount_cents / qty || 0), currency);
      const totalPrice = formatMoney(Number(item.total_price_cents || item.amount_cents || 0), currency);
      const productName = item.product_name || item.name || item.description || "Item";
      return `
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 12px; text-align: left;">${escapeHtml(productName)}</td>
          <td style="padding: 12px; text-align: center;">${qty}</td>
          <td style="padding: 12px; text-align: right;">${unitPrice}</td>
          <td style="padding: 12px; text-align: right; font-weight: 600;">${totalPrice}</td>
        </tr>
      `;
    })
    .join("");

  const totalPrice = formatMoney(total_cents, currency);
  const timestamp = new Date().toLocaleString();

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1b7991; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
        .receipt-info { background: white; padding: 16px; border-radius: 6px; margin-bottom: 20px; border-left: 4px solid #1b7991; }
        .receipt-info p { margin: 8px 0; font-size: 14px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; background: white; border-radius: 6px; overflow: hidden; }
        table th { background: #f3f4f6; padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #e5e7eb; }
        .total-row { background: #f3f4f6; font-weight: 600; font-size: 18px; }
        .total-row td { padding: 16px; }
        .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; margin-top: 20px; }
        .button { display: inline-block; padding: 12px 24px; background: #1b7991; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✓ Thank You for Your Purchase</h1>
        </div>
        <div class="content">
          <p style="font-size: 16px; margin-bottom: 20px;">Hi,</p>
          <p style="font-size: 14px; color: #6b7280;">We've received your payment. Here's a summary of your order:</p>
          
          <div class="receipt-info">
            <p><strong>Receipt ID:</strong> ${escapeHtml(String(receipt_id || ""))}</p>
            <p><strong>Date & Time:</strong> ${timestamp}</p>
            <p><strong>Currency:</strong> ${escapeHtml(currency.toUpperCase())}</p>
          </div>

          <h3 style="margin-top: 24px; margin-bottom: 12px;">Order Details</h3>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th style="text-align: center;">Qty</th>
                <th style="text-align: right;">Unit Price</th>
                <th style="text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
              <tr class="total-row">
                <td colspan="3" style="text-align: right;">Total Amount:</td>
                <td style="text-align: right;">${totalPrice}</td>
              </tr>
            </tbody>
          </table>

          <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
            If you have any questions about your order, please don't hesitate to contact us.
          </p>

          <div style="text-align: center; margin-top: 20px;">
            <a href="https://nobelcart.com" class="button">View Your Account</a>
          </div>

          <div class="footer">
            <p>NobelCart - Your trusted marketplace</p>
            <p>© ${new Date().getFullYear()} NobelCart. All rights reserved.</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  // Send via Resend if available, otherwise just log success
  if (RESEND_API_KEY) {
    try {
      const emailRes = await fetch(RESEND_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: user_email,
          subject: `Receipt Confirmation - Order #${receipt_id || ""}`,
          html: htmlBody,
        }),
      });

      if (!emailRes.ok) {
        const err = await emailRes.text().catch(() => "Unknown error");
        console.warn(`Resend API error: ${emailRes.status} ${err}`);
        return successResponse({
          ok: true,
          message: "Receipt saved (email sending failed, but order was processed)",
          email_sent: false,
        });
      }

      // Mark as sent in DB
      if (receipt_id && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
          await supabase.from('receipts').update({ email_sent: true }).eq('id', receipt_id);
        } catch (_) {}
      }

      const emailData = await emailRes.json();
      return successResponse({
        ok: true,
        message: "Receipt email sent successfully",
        email_sent: true,
        email_id: emailData.id,
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
    // No Resend API key configured - just log and return success
    console.log(
      `Email would be sent to ${user_email} for receipt ${receipt_id} (RESEND_API_KEY not configured)`
    );
    return successResponse({
      ok: true,
      message: "Receipt saved (email service not configured)",
      email_sent: false,
    });
  }
});

function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}
