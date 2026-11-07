import { AuthFlowError, prepareChallenge, challengeMetadata, deliveryFailure } from './auth-security.ts';
import { canSendSms, deliverPreferredMessage } from "./sms-consent.mjs";
import { verificationEmailHtml } from "./verification-email.mjs";
import { SUPPORT_EMAIL } from "./email-layout.mjs";
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

/** Per-customer SMS preference. An explicit email override remains a rollout switch. */
export function smsReady(): boolean {
  return !!Deno.env.get('BREVO_API_KEY') && !!Deno.env.get('BREVO_SMS_SENDER') &&
    (Deno.env.get('OTP_CHANNEL') || 'auto').trim().toLowerCase() !== 'email';
}

export async function accountSmsAllowed(
  admin: ReturnType<typeof adminClient>, userId: string, phone: string, purpose = 'account',
): Promise<boolean> {
  const { data, error } = await admin.from('sms_consents')
    .select('phone, opted_in, consent_version').eq('user_id', userId).maybeSingle();
  return !error && canSendSms(data, phone, purpose);
}

/** Use only a registered Brevo sender configured in BREVO_SMS_SENDER. */
export async function sendBrevoSms(phone: string, content: string): Promise<{ messageId?: string | number }> {
  const key = Deno.env.get("BREVO_API_KEY") || "";
  if (!key) throw new Error("SMS is not configured (BREVO_API_KEY).");

  // US/CA need a registered toll-free / 10DLC number as sender — set BREVO_SMS_SENDER.
  const senderRaw = (Deno.env.get("BREVO_SMS_SENDER") || "NobelCart").trim();
  const sender = senderRaw.slice(0, 15);

  let body = content;
  if (phone.startsWith("+1") && !/^NobleCart[:\s]/i.test(body)) {
    body = `NobleCart: ${body}`;
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

/** All customer email uses the same Brevo identity and provider. */
export async function sendBrevoEmail(opts: {
  email: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
}): Promise<{ messageId?: string | number }> {
  const key = Deno.env.get("BREVO_API_KEY") || "";
  if (!key) throw new Error("Email is not configured (BREVO_API_KEY).");
  const fromEmail = (Deno.env.get("FROM_EMAIL") || SUPPORT_EMAIL).trim();
  const fromName = (Deno.env.get("BREVO_OTP_FROM_NAME") || "NobleCart").trim();
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      replyTo: { email: fromEmail, name: fromName },
      to: [{ email: opts.email }],
      subject: opts.subject,
      htmlContent: opts.htmlContent,
      ...(opts.textContent ? { textContent: opts.textContent } : {}),
    }),
  });
  if (!res.ok) {
    // Keep provider error details in server logs, never include API keys.
    const detail = await res.text().catch(() => "");
    console.error("Brevo email error", res.status, detail);
    throw new Error(`Failed to send email (${res.status}). Verify sender ${fromEmail} in Brevo.`);
  }
  const result = await res.json();
  return { messageId: result.messageId };
}

/** Signup / recovery OTP with the approved NobleCart design. */
export async function sendOtpEmail(email: string, code: string): Promise<{ messageId?: string | number }> {
  return sendBrevoEmail({
    email,
    subject: "Your NobleCart verification",
    htmlContent: verificationEmailHtml(code),
    textContent: `Your NobleCart verification: ${code}. It expires in 10 minutes.`,
  });
}

/** Prefer SMS only with consent; report the channel that actually accepted the code. */
export async function sendSignupOtp(opts: {
  email: string;
  phone: string;
  code: string;
  smsOptIn?: boolean;
  forceEmail?: boolean;
}): Promise<{ messageId?: string | number; channel: "email" | "sms" }> {
  return deliverPreferredMessage({ optedIn: opts.smsOptIn, smsReady: smsReady(), forceEmail: opts.forceEmail }, {
    sms: () => sendBrevoSms(opts.phone, `NobleCart: Your verification code is ${opts.code}. It expires in 10 minutes. Do not share it. Reply STOP to cancel or HELP for help.`),
    email: () => sendOtpEmail(opts.email, opts.code),
    onSmsError: (e: unknown) => console.warn('SMS unavailable; delivering verification by email instead.', e),
  });
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

/** Create OTP row and send using the saved preference. Deletes prior OTPs for this user/phone. */
export async function issueOtp(
  admin: ReturnType<typeof adminClient>, userId: string, phone: string, email: string,
  forceEmail = false,
) {
  const challenge = await prepareChallenge(admin, 'legacy', { user_id: userId, phone, email });
  try {
    const allowed = await accountSmsAllowed(admin, userId, phone);
    const sent = await sendSignupOtp({ email, phone, code: challenge.code, smsOptIn: allowed, forceEmail });
    return { ...challengeMetadata(challenge), channel: sent.channel, messageId: sent.messageId };
  } catch { throw deliveryFailure(challenge); }
}

/** The database reserves sends and updates the challenge in one transaction. */
export async function upsertPendingSignup(
  admin: ReturnType<typeof adminClient>,
  row: { email: string; phone: string; full_name: string; date_of_birth: string;
    signup_source?: 'kiosk_signup' | 'app_signup'; sms_opt_in?: boolean;
    sms_consent_version?: string | null; sms_consent_text?: string | null; sms_consent_at?: string | null; },
  token?: string,
) {
  const challenge = await prepareChallenge(admin, 'signup', row, token);
  try {
    const sent = await sendSignupOtp({ email: row.email, phone: row.phone, code: challenge.code, smsOptIn: row.sms_opt_in === true });
    return { ...challengeMetadata(challenge), channel: sent.channel, messageId: sent.messageId };
  } catch { throw deliveryFailure(challenge); }
}

export function authFailureResponse(error: unknown) {
  if (error instanceof AuthFlowError) {
    const response = bad(error.message, error.status, error.extra);
    if (typeof error.extra.retry_after === 'number') response.headers.set('Retry-After', String(error.extra.retry_after));
    return response;
  }
  console.error('Auth request failed', error instanceof Error ? error.message : 'Unknown error');
  return bad('Verification is temporarily unavailable. Please try again.', 503);
}

/** Password sign-in via anon client; returns session object. */
export async function passwordSession(email: string, password: string) {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}
