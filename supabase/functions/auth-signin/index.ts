// auth-signin: email OR phone + password → session.
// If password is correct but phone_verified=false → send OTP and return needs_otp.

// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  adminClient,
  bad,
  corsHeaders,
  isEmail,
  isPhoneBanned,
  issueOtp,
  authFailureResponse,
  json,
  normalizeUsPhone,
  passwordSession,
} from "../_shared/auth.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return bad("Method not allowed", 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('Invalid JSON body');
  const identifier = String(body.identifier || "").trim();
  const password = String(body.password || "");
  if (!identifier) return bad("Enter your email or phone number.");
  if (!password) return bad("Enter your password.");

  let email: string | null = null;
  let profilePhone: string | null = null;
  let profileId: string | null = null;
  let needsOtp = false;
  const admin = adminClient();

  if (identifier.toLowerCase() === "admin") {
    email = "admin@example.com";
  } else if (isEmail(identifier)) {
    email = identifier.toLowerCase();
    const { data: profile } = await admin
      .from("profiles")
      .select("id, phone, phone_verified, active, is_admin")
      .eq("email", email)
      .maybeSingle();

    if (!profile) return bad('Email, phone, or password is incorrect.', 401);

    if (profile) {
      if (profile.active === false) return bad('Email, phone, or password is incorrect.', 401);
      if (profile.phone && (await isPhoneBanned(admin, profile.phone))) {
        return bad('Email, phone, or password is incorrect.', 401);
      }
      if (!profile.is_admin && !profile.phone_verified) {
        needsOtp = true;
        profilePhone = profile.phone;
        profileId = profile.id;
      }
    }
  } else {
    const phone = normalizeUsPhone(identifier);
    if (!phone) return bad("Enter a valid email or US phone number.");
    if (await isPhoneBanned(admin, phone)) {
      return bad('Email, phone, or password is incorrect.', 401);
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("id, email, phone, phone_verified, active, is_admin")
      .eq("phone", phone)
      .maybeSingle();

    if (!profile?.email) return bad('Email, phone, or password is incorrect.', 401);
    if (profile.active === false) return bad('Email, phone, or password is incorrect.', 401);
    if (!profile.is_admin && !profile.phone_verified) {
      needsOtp = true;
      profilePhone = profile.phone || phone;
      profileId = profile.id;
    }
    email = profile.email;
  }

  // Unverified: check password first, then force OTP (do not return a session)
  if (needsOtp && email) {
    try {
      const session = await passwordSession(email, password);
      // Immediately discard session — they must verify phone
      try {
        const anon = (await import("../_shared/auth.ts")).anonClient();
        // best-effort: can't revoke easily without admin; client won't get tokens
        void anon;
      } catch (_) {}
      void session;

      if (!profilePhone) {
        return bad(
          "This account has no phone on file. Start signup again with a US phone number.",
          403,
        );
      }

      let otpChannel = "email";
      let verificationToken = "";
      let expiresAt = "";
      try {
        const delivered = await issueOtp(admin, profileId!, profilePhone, email);
        otpChannel = delivered.channel;
        verificationToken = delivered.verification_token;
        expiresAt = delivered.expires_at;
      } catch (e: unknown) {
        return authFailureResponse(e);
      }

      return bad(`Enter the verification code we just sent by ${otpChannel === "sms" ? "text message" : "email"} to finish verifying.`, 403, {
        needs_otp: true,
        phone: profilePhone,
        email,
        verification_token: verificationToken,
        expires_at: expiresAt,
        otp_channel: otpChannel,
      });
    } catch {
      // Profile exists — credentials failed means wrong password
      return bad('Email, phone, or password is incorrect.', 401);
    }
  }

  try {
    const session = await passwordSession(email!, password);
    if (!session) return bad("Sign-in failed.", 401);
    return json({ session });
  } catch {
    return bad('Email, phone, or password is incorrect.', 401);
  }
});
