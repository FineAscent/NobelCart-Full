// auth-signup: store PENDING signup + send OTP. No auth.users until OTP verify.
// Body: { full_name, date_of_birth, phone, email, password }
// Returns: { pending_id, phone, expires_at } — password must be sent again on verify.

// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  adminClient,
  bad,
  corsHeaders,
  deleteUnverifiedOrphans,
  isEmail,
  isPhoneBanned,
  json,
  normalizeUsPhone,
  parseDob,
  upsertPendingSignup,
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
    return bad("An account with this phone number already exists. Please sign in.", 409);
  }

  const { data: existingEmail } = await admin
    .from("profiles")
    .select("id, phone_verified, is_admin")
    .eq("email", email)
    .maybeSingle();
  if (existingEmail?.phone_verified || existingEmail?.is_admin) {
    return bad("An account with this email already exists. Please sign in.", 409);
  }

  // Remove any unfinished auth users so nothing is left if they abandon OTP
  await deleteUnverifiedOrphans(admin, email, phone);

  try {
    const pending = await upsertPendingSignup(admin, {
      email,
      phone,
      full_name,
      date_of_birth: dob.iso,
    });
    return json({
      pending_id: pending.pending_id,
      phone: pending.phone,
      email: pending.email,
      expires_at: pending.expires_at,
      otp_channel: pending.channel,
      sms_message_id: pending.messageId ?? null,
      // No user_id — account is created only after OTP
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to send verification code.";
    return bad(msg, 502);
  }
});
