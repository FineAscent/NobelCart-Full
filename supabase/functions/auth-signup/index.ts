import { verificationToken } from '../_shared/auth-security.ts';
// auth-signup: store PENDING signup + send OTP. No auth.users until OTP verify.
// GET ?action=sms-consent: current optional SMS disclosure and version.
// POST: { full_name, date_of_birth, phone, email, password, client_type?, sms_opt_in?, sms_consent_version? }
// Returns pending signup, actual otp_channel, and captured choice; password is sent again on verify.

// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  adminClient,
  bad,
  corsHeaders,
  authFailureResponse,
  isEmail,
  isPhoneBanned,
  json,
  normalizeUsPhone,
  parseDob,
  upsertPendingSignup,
} from "../_shared/auth.ts";

import { captureSmsConsent, smsConsentForm, signupConsentSource } from "../_shared/sms-consent.mjs";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === 'GET') {
    if (new URL(req.url).searchParams.get('action') !== 'sms-consent') {
      return bad('Use action=sms-consent to fetch signup messaging options.');
    }
    return new Response(JSON.stringify({ sms_consent: smsConsentForm() }), {
      headers: { ...corsHeaders, 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  if (req.method !== "POST") return bad("Method not allowed", 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('Invalid JSON body');
  const full_name = String(body.full_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const phoneRaw = String(body.phone || "").trim();
  const dobRaw = String(body.date_of_birth || "").trim();

  if (!full_name) return bad("Full name is required.");
  if (!isEmail(email)) return bad("A valid email is required.");
  if (!password || password.length < 7) return bad("Password must be at least 7 letters or numbers.");
  if (!/^[a-zA-Z0-9]+$/.test(password)) return bad("Password can only use letters and numbers.");

  const phone = normalizeUsPhone(phoneRaw);
  if (!phone) return bad("Enter a valid US phone number.");

  const dob = parseDob(dobRaw);
  if (!dob.ok) return bad(dob.error);

  let smsConsent;
  let signupSource;
  try {
    signupSource = signupConsentSource(body.client_type);
    smsConsent = captureSmsConsent(body.sms_opt_in, body.sms_consent_version);
  } catch (e) {
    return bad(e instanceof Error ? e.message : 'Please review the SMS terms.', 400, {
      code: body.client_type != null && !['app', 'kiosk'].includes(String(body.client_type))
        ? 'INVALID_CLIENT_TYPE' : 'SMS_CONSENT_VERSION_MISMATCH',
      sms_consent: smsConsentForm(),
    });
  }
  const admin = adminClient();

  if (await isPhoneBanned(admin, phone)) {
    return bad("This phone number cannot be used to create an account.", 403);
  }

  // Verified accounts block reuse
  const { data: existingPhone } = await admin
    .from("profiles")
    .select("id, phone_verified")
    .eq("phone", phone)
    .eq("phone_verified", true)
    .maybeSingle();
  if (existingPhone) {
    return bad("Unable to start or update signup. Continue your current verification or try again later.", 409);
  }

  const { data: existingEmail } = await admin
    .from("profiles")
    .select("id, phone_verified, is_admin")
    .eq("email", email)
    .maybeSingle();
  if (existingEmail) {
    return bad("Unable to start or update signup. Continue your current verification or try again later.", 409);
  }

  try {
    const pending = await upsertPendingSignup(admin, {
      email,
      phone,
      full_name,
      date_of_birth: dob.iso,
      ...smsConsent,
      signup_source: signupSource,
    }, verificationToken(body.verification_token));
    return json({
      pending_id: pending.pending_id,
      verification_token: pending.verification_token,
      phone: pending.phone,
      email: pending.email,
      expires_at: pending.expires_at,
      otp_channel: pending.channel,
      sms_opt_in: smsConsent.sms_opt_in,
      sms_consent_version: smsConsent.sms_consent_version,
      signup_source: signupSource,
      sms_message_id: pending.messageId ?? null,
      // No user_id — account is created only after OTP
    });
  } catch (e: unknown) {
    return authFailureResponse(e);
  }
});
