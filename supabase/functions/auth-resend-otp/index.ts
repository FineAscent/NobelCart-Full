// auth-resend-otp: resend for pending signup OR unverified profile (rate-limited).
// Default delivery is email — see OTP_CHANNEL comments in _shared/auth.ts
// Body: { phone }

// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  adminClient,
  bad,
  corsHeaders,
  issueOtp,
  json,
  normalizeUsPhone,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  randomOtp6,
  sendSignupOtp,
  sha256Hex,
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

  const phone = normalizeUsPhone(String(body.phone || ""));
  if (!phone) return bad("Enter a valid US phone number.");

  const admin = adminClient();

  const { data: pending } = await admin
    .from("pending_signups")
    .select("*")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pending) {
    const lastSend = new Date(pending.expires_at).getTime() - OTP_TTL_MS;
    const since = Date.now() - lastSend;
    if (since < OTP_RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - since) / 1000);
      return bad(`Please wait ${wait}s before requesting another code.`, 429);
    }

    const code = randomOtp6();
    const code_hash = await sha256Hex(`${phone}:${code}`);
    const expires_at = new Date(Date.now() + OTP_TTL_MS).toISOString();
    await admin
      .from("pending_signups")
      .update({ code_hash, expires_at, attempts: 0 })
      .eq("id", pending.id);

    try {
      const sent = await sendSignupOtp({ email: pending.email, phone, code });
      return json({
        phone,
        email: pending.email,
        expires_at,
        pending_id: pending.id,
        otp_channel: sent.channel,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to send verification code.";
      return bad(msg, 502);
    }
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, phone_verified")
    .eq("phone", phone)
    .maybeSingle();

  if (!profile) return bad("No pending verification for that phone. Start signup again.", 404);
  if (profile.phone_verified) return bad("Already verified. Please sign in.", 409);
  if (!profile.email) return bad("Account has no email for verification.", 400);

  const { data: last } = await admin
    .from("otp_verifications")
    .select("created_at")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (last?.created_at) {
    const age = Date.now() - new Date(last.created_at).getTime();
    if (age < OTP_RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - age) / 1000);
      return bad(`Please wait ${wait}s before requesting another code.`, 429);
    }
  }

  try {
    const { expires_at, channel } = await issueOtp(admin, profile.id, phone, profile.email);
    return json({
      phone,
      email: profile.email,
      expires_at,
      user_id: profile.id,
      otp_channel: channel,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to send verification code.";
    return bad(msg, 502);
  }
});
