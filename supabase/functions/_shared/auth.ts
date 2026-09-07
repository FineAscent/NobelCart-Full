// Shared helpers for NobelCart auth edge functions.

// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

export function bad(msg: string, status = 400, extra: Record<string, unknown> = {}) {
  return json({ error: msg, ...extra }, status);
}

/** Normalize US phone to E.164 (+1XXXXXXXXXX). Returns null if invalid. */
export function normalizeUsPhone(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  let ten: string | null = null;
  if (digits.length === 10) ten = digits;
  else if (digits.length === 11 && digits.startsWith("1")) ten = digits.slice(1);
  else return null;
  // NANP: area code cannot start with 0 or 1
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  return `+1${ten}`;
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

/** Minimum age in years (inclusive). */
export const MIN_AGE_YEARS = 13;
/** Maximum age in years (exclusive upper bound — 130+ is rejected). */
export const MAX_AGE_YEARS = 130;

export function parseDob(raw: string): { ok: true; iso: string } | { ok: false; error: string } {
  const s = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { ok: false, error: "Date of birth must be YYYY-MM-DD." };
  }
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    return { ok: false, error: "Invalid date of birth." };
  }
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (d.getTime() > todayUtc) {
    return { ok: false, error: "Date of birth can’t be in the future." };
  }
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  if (age < MIN_AGE_YEARS) {
    return { ok: false, error: `You must be at least ${MIN_AGE_YEARS} years old.` };
  }
  if (age >= MAX_AGE_YEARS) {
    return { ok: false, error: "Invalid date of birth." };
  }
  return { ok: true, iso: s };
}

export function randomOtp6(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

/**
 * OTP delivery channel.
 *
 * CURRENT (website): "email" — Brevo transactional email (no US SMS registration needed).
 *
 * TO ENABLE REAL SMS LATER (after US business / toll-free sender is approved in Brevo):
 *   1. In Brevo: register a US toll-free / 10DLC sender for transactional SMS.
 *   2. Supabase secret: BREVO_SMS_SENDER=+1XXXXXXXXXX  (the approved number)
 *   3. Supabase secret: OTP_CHANNEL=sms
 *   4. Redeploy auth-signup, auth-verify-otp, auth-resend-otp, auth-update-phone, auth-signin
 *   5. Update kiosk copy back to "SMS code" if you want (create-account.html / signin.html)
 *
 * Phone numbers are still collected + stored for bans / future SMS even while OTP_CHANNEL=email.
 */
export function otpChannel(): "email" | "sms" {
  const v = (Deno.env.get("OTP_CHANNEL") || "email").trim().toLowerCase();
  return v === "sms" ? "sms" : "email";
}

/** Hold SMS until US sender is registered — see otpChannel() comments above. */
export async function sendBrevoSms(phone: string, content: string): Promise<{ messageId?: string | number }> {
  const key = Deno.env.get("BREVO_API_KEY") || "";
  if (!key) throw new Error("SMS is not configured (BREVO_API_KEY).");

  // US/CA need a registered toll-free / 10DLC number as sender — set BREVO_SMS_SENDER.
  const senderRaw = (Deno.env.get("BREVO_SMS_SENDER") || "NobelCart").trim();
  const sender = senderRaw.slice(0, 15);

  let body = content;
  if (phone.startsWith("+1") && !/^NobelCart[:\s]/i.test(body)) {
    body = `NobelCart: ${body}`;
  }

  const payload = {
    type: "transactional",
    sender,
    recipient: phone,
    content: body,
  };

  const endpoints = [
    "https://api.brevo.com/v3/transactionalSMS/sms",
    "https://api.brevo.com/v3/transactionalSMS/send",
  ];

  let lastErr = "Failed to send SMS.";
  for (const url of endpoints) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": key,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text().catch(() => "");
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }

    if (res.ok) {
      const messageId = (parsed.messageId ?? parsed.reference) as string | number | undefined;
      console.log("Brevo SMS ok", { url, phone, sender, messageId, parsed });
      return { messageId };
    }

    if (res.status === 404) {
      lastErr = `Failed to send SMS (${res.status}): ${text || res.statusText}`;
      continue;
    }

    console.error("Brevo SMS error", { url, status: res.status, text, sender, phone });
    throw new Error(
      `Failed to send SMS (${res.status}): ${text || res.statusText}. ` +
        `For US numbers, set BREVO_SMS_SENDER to your Brevo-registered toll-free number.`,
    );
  }

  throw new Error(lastErr);
}

/** Signup / recovery OTP via Brevo transactional email (default channel). */
export async function sendOtpEmail(
  email: string,
  code: string,
): Promise<{ messageId?: string | number }> {
  const key = Deno.env.get("BREVO_API_KEY") || "";
  if (!key) throw new Error("Email OTP is not configured (BREVO_API_KEY).");

  // Must be a sender verified in Brevo (SMTP & API → Senders).
  // noreply@nobelcart.com is NOT verified and Gmail returns a silent delivery error.
  const fromEmail = (
    Deno.env.get("BREVO_OTP_FROM_EMAIL") ||
    Deno.env.get("FROM_EMAIL") ||
    ""
  ).trim();
  if (!fromEmail) {
    throw new Error(
      "Email OTP sender is not configured. Set BREVO_OTP_FROM_EMAIL to a verified Brevo sender.",
    );
  }
  const fromName = (Deno.env.get("BREVO_OTP_FROM_NAME") || "NobleCart").trim();

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": key,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email }],
      subject: "Your NobleCart verification",
      htmlContent:
        `<p>Your NobleCart verification:</p>` +
        `<p style="font-size:28px;letter-spacing:4px;font-weight:700;">${code}</p>` +
        `<p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
      textContent: `Your NobleCart verification: ${code}. It expires in 10 minutes.`,
    }),
  });

  const text = await res.text().catch(() => "");
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }

  if (!res.ok) {
    console.error("Brevo email OTP error", res.status, text);
    throw new Error(
      `Failed to send verification email (${res.status}): ${text || res.statusText}. ` +
        `Verify sender ${fromEmail} in Brevo (SMTP & API → Senders).`,
    );
  }

  const messageId = parsed.messageId as string | number | undefined;
  console.log("Brevo email OTP ok", { email, fromEmail, messageId });
  return { messageId };
}

/** Send OTP using current channel (email now; SMS when OTP_CHANNEL=sms). */
export async function sendSignupOtp(opts: {
  email: string;
  phone: string;
  code: string;
}): Promise<{ messageId?: string | number; channel: "email" | "sms" }> {
  const channel = otpChannel();
  const content = `Your verification code is ${opts.code}. It expires in 10 minutes.`;

  if (channel === "sms") {
    // Requires BREVO_SMS_SENDER — see otpChannel() header comment.
    const { messageId } = await sendBrevoSms(opts.phone, content);
    return { messageId, channel };
  }

  const { messageId } = await sendOtpEmail(opts.email, opts.code);
  return { messageId, channel };
}

export async function upsertBrevoContact(opts: {
  email: string;
  phone: string;
  fullName: string;
  dateOfBirth?: string | null;
}): Promise<void> {
  const key = Deno.env.get("BREVO_API_KEY") || "";
  if (!key) return; // non-fatal if SMS works but contacts unset
  const parts = String(opts.fullName || "").trim().split(/\s+/);
  const first = parts[0] || "";
  const last = parts.slice(1).join(" ") || "";
  const attributes: Record<string, string> = {
    FIRSTNAME: first,
    LASTNAME: last,
    SMS: opts.phone,
  };
  if (opts.dateOfBirth) attributes.DOB = opts.dateOfBirth;

  const res = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: {
      "api-key": key,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      email: opts.email,
      attributes,
      updateEnabled: true,
    }),
  });
  // 204 / 201 ok; 400 duplicate sometimes — ignore soft failures
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    console.warn("Brevo contact upsert failed:", res.status, text);
  }
}

export async function createStripeCustomer(opts: {
  email: string;
  name: string;
  phone: string;
  userId: string;
}): Promise<string | null> {
  const key = Deno.env.get("STRIPE_SECRET_KEY") || "";
  if (!key) {
    console.warn("STRIPE_SECRET_KEY not set; skipping customer create");
    return null;
  }
  const form = new URLSearchParams();
  form.set("email", opts.email);
  form.set("name", opts.name);
  form.set("phone", opts.phone);
  form.set("metadata[user_id]", opts.userId);
  const res = await fetch("https://api.stripe.com/v1/customers", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Stripe customer create failed:", res.status, text);
    return null;
  }
  const data = await res.json();
  return data?.id || null;
}

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function anonClient(authHeader?: string | null) {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_ANON_KEY") || "";
  return createClient(url, key, {
    global: authHeader ? { headers: { Authorization: authHeader } } : undefined,
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function isPhoneBanned(admin: ReturnType<typeof adminClient>, phone: string): Promise<boolean> {
  const { data } = await admin
    .from("banned_identifiers")
    .select("id")
    .eq("type", "phone")
    .eq("value", phone)
    .maybeSingle();
  return !!data;
}

export async function isFingerprintBanned(
  admin: ReturnType<typeof adminClient>,
  fingerprint: string,
): Promise<boolean> {
  const { data } = await admin
    .from("banned_identifiers")
    .select("id")
    .eq("type", "card_fingerprint")
    .eq("value", fingerprint)
    .maybeSingle();
  return !!data;
}

/** Create OTP row + send code (email by default). Deletes prior OTPs for this user/phone. */
export async function issueOtp(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  phone: string,
  email: string,
): Promise<{ expires_at: string; messageId?: string | number; channel: "email" | "sms" }> {
  const code = randomOtp6();
  const code_hash = await sha256Hex(`${phone}:${code}`);
  const expires_at = new Date(Date.now() + OTP_TTL_MS).toISOString();

  await admin.from("otp_verifications").delete().eq("user_id", userId);
  const { error } = await admin.from("otp_verifications").insert({
    user_id: userId,
    phone,
    code_hash,
    expires_at,
    attempts: 0,
  });
  if (error) throw new Error(error.message || "Failed to store OTP");

  const sent = await sendSignupOtp({ email, phone, code });
  return { expires_at, messageId: sent.messageId, channel: sent.channel };
}

/** Store pending signup + OTP. No auth.users row until verify succeeds. */
export async function upsertPendingSignup(
  admin: ReturnType<typeof adminClient>,
  row: {
    email: string;
    phone: string;
    full_name: string;
    date_of_birth: string;
  },
): Promise<{
  pending_id: string;
  phone: string;
  email: string;
  expires_at: string;
  messageId?: string | number;
  channel: "email" | "sms";
}> {
  const code = randomOtp6();
  const code_hash = await sha256Hex(`${row.phone}:${code}`);
  const expires_at = new Date(Date.now() + OTP_TTL_MS).toISOString();

  await admin.from("pending_signups").delete().eq("email", row.email);
  await admin.from("pending_signups").delete().eq("phone", row.phone);

  const { data, error } = await admin
    .from("pending_signups")
    .insert({
      email: row.email,
      phone: row.phone,
      full_name: row.full_name,
      date_of_birth: row.date_of_birth,
      code_hash,
      expires_at,
      attempts: 0,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(error?.message || "Failed to store pending signup");

  const sent = await sendSignupOtp({ email: row.email, phone: row.phone, code });
  return {
    pending_id: data.id,
    phone: row.phone,
    email: row.email,
    expires_at,
    messageId: sent.messageId,
    channel: sent.channel,
  };
}

/** Delete orphan unverified auth users for email/phone so signup can proceed cleanly. */
export async function deleteUnverifiedOrphans(
  admin: ReturnType<typeof adminClient>,
  email: string,
  phone: string,
): Promise<void> {
  const { data: rows } = await admin
    .from("profiles")
    .select("id, email, phone, phone_verified, is_admin")
    .or(`email.eq.${email},phone.eq.${phone}`);

  for (const p of rows || []) {
    if (p.is_admin) continue;
    if (p.phone_verified) continue;
    try {
      await admin.auth.admin.deleteUser(p.id);
    } catch (e) {
      console.warn("Failed to delete unverified orphan", p.id, e);
    }
  }
}

/** Password sign-in via anon client; returns session object. */
export async function passwordSession(email: string, password: string) {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}
