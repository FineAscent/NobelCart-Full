// auth-update-phone: change phone on a PENDING signup (or unverified profile).
// OTP is resent to email by default (see OTP_CHANNEL / sendSignupOtp comments).
// Body: { pending_id?, user_id?, phone }

// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  adminClient,
  bad,
  corsHeaders,
  isPhoneBanned,
  issueOtp,
  json,
  normalizeUsPhone,
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

  const pendingId = String(body.pending_id || "").trim();
  const userId = String(body.user_id || "").trim();
  const phone = normalizeUsPhone(String(body.phone || ""));
  if (!phone) return bad("Enter a valid US phone number.");
  if (!pendingId && !userId) return bad("pending_id or user_id is required.");

  const admin = adminClient();

  if (await isPhoneBanned(admin, phone)) {
    return bad("This phone number cannot be used.", 403);
  }

  const { data: takenVerified } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .eq("phone_verified", true)
    .maybeSingle();
  if (takenVerified) return bad("That phone number is already in use.", 409);

  if (pendingId) {
    const { data: pending } = await admin
      .from("pending_signups")
      .select("*")
      .eq("id", pendingId)
      .maybeSingle();
    if (!pending) return bad("Signup session expired. Start again.", 404);

    const { data: phoneTaken } = await admin
      .from("pending_signups")
      .select("id")
      .eq("phone", phone)
      .neq("id", pendingId)
      .maybeSingle();
    if (phoneTaken) return bad("That phone number is already in use.", 409);

    const code = randomOtp6();
    const code_hash = await sha256Hex(`${phone}:${code}`);
    const expires_at = new Date(Date.now() + OTP_TTL_MS).toISOString();

    const { error } = await admin
      .from("pending_signups")
      .update({ phone, code_hash, expires_at, attempts: 0 })
      .eq("id", pendingId);
    if (error) return bad(error.message || "Failed to update phone.", 500);

    try {
      const sent = await sendSignupOtp({ email: pending.email, phone, code });
      return json({
        pending_id: pendingId,
        phone,
        email: pending.email,
        expires_at,
        otp_channel: sent.channel,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to send verification code.";
      return bad(msg, 502, { pending_id: pendingId, phone });
    }
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, phone_verified")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return bad("Account not found.", 404);
  if (profile.phone_verified) {
    return bad("Phone is already verified and cannot be changed here.", 409);
  }
  if (!profile.email) return bad("Account has no email for verification.", 400);

  const { error: updErr } = await admin
    .from("profiles")
    .update({ phone, phone_verified: false })
    .eq("id", userId);
  if (updErr) return bad(updErr.message || "Failed to update phone.", 500);

  try {
    const { expires_at, channel } = await issueOtp(admin, userId, phone, profile.email);
    return json({ user_id: userId, phone, email: profile.email, expires_at, otp_channel: channel });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to send verification code.";
    return bad(msg, 502, { user_id: userId, phone });
  }
});
