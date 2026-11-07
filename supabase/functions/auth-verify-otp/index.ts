import { checkChallenge } from '../_shared/auth-security.ts';
// auth-verify-otp:
// 1) Pending signup → create auth user ONLY after OTP matches
// 2) Legacy unverified profile → mark verified (signin recovery)
// Body: { phone, code, password }

// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  adminClient,
  anonClient,
  bad,
  corsHeaders,
  createStripeCustomer,
  json,
  normalizeUsPhone,
  authFailureResponse,
  passwordSession,
  upsertBrevoContact,
} from "../_shared/auth.ts";

// Only release a consumed code after an unambiguous account/profile failure.
// Counters stay incremented, so retries cannot reset either attempt budget.
async function releaseFailedChallenge(admin: ReturnType<typeof adminClient>, challenge: any) {
  const row = challenge.record;
  const table = challenge.kind === 'pending' ? 'pending_signups' : 'otp_verifications';
  const { error } = await admin.from(table).update({ consumed_at: null })
    .eq('id', row.id).eq('code_hash', row.code_hash).eq('verification_token_hash', row.verification_token_hash);
  if (error) console.warn('Unable to release failed verification challenge');
}

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
  const phone = normalizeUsPhone(String(body.phone || ""));
  const code = String(body.code || "").trim().replace(/\s+/g, "");
  const password = String(body.password || "");

  if (!phone) return bad("Enter a valid US phone number.");
  if (!/^\d{6}$/.test(code)) return bad("Enter the 6-digit code.");
  if (!password || password.length < 7) {
    return bad("Password must be at least 7 letters or numbers.");
  }
  if (!/^[a-zA-Z0-9]+$/.test(password)) {
    return bad("Password can only use letters and numbers.");
  }

  const admin = adminClient();
  let challenge;
  try { challenge = await checkChallenge(admin, phone, code, body.verification_token); }
  catch (e) { return authFailureResponse(e); }

  // A successful database check has already consumed this challenge exactly once.
  if (challenge.kind === 'pending') {
    const pending = challenge.record;
    // OTP OK → create the real account now
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: pending.email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: pending.full_name,
        phone,
        date_of_birth: pending.date_of_birth,
      },
    });

    if (createErr || !created?.user) {
      const msg = createErr?.message || "Failed to create account.";
      if (/already|registered|exists/i.test(msg)) {
        return bad("An account with this email already exists. Please sign in.", 409);
      }
      await releaseFailedChallenge(admin, challenge);
      return bad(msg, 400);
    }

    const userId = created.user.id;
    const stripeCustomerId = await createStripeCustomer({
      email: pending.email,
      name: pending.full_name,
      phone,
      userId,
    });

    const { error: profErr } = await admin.from("profiles").upsert(
      {
        id: userId,
        email: pending.email,
        display_name: pending.full_name,
        phone,
        phone_verified: true,
        date_of_birth: pending.date_of_birth,
        stripe_customer_id: stripeCustomerId,
        active: true,
      },
      { onConflict: "id" },
    );

    if (profErr) {
      try {
        const { error: cleanupError } = await admin.auth.admin.deleteUser(userId);
        if (!cleanupError) await releaseFailedChallenge(admin, challenge);
      } catch (_) {}
      return bad(profErr.message || "Failed to save profile.", 500);
    }

    // Record the server-captured disclosure and choice only for a verified account.
    const { error: consentError } = await admin.from("sms_consents").insert({
      user_id: userId,
      phone,
      opted_in: pending.sms_opt_in === true,
      consent_version: pending.sms_consent_version || null,
      consent_text: pending.sms_consent_text || null,
      consented_at: pending.sms_consent_at || null,
      source: pending.signup_source === 'app_signup' ? 'app_signup' : 'kiosk_signup',
    });
    if (consentError) {
      try {
        const { error: cleanupError } = await admin.auth.admin.deleteUser(userId);
        if (!cleanupError) await releaseFailedChallenge(admin, challenge);
      } catch (_) {}
      return bad('Could not save your messaging preference. Please try again.', 500);
    }

    const messagingPreference = {
      sms_opt_in: pending.sms_opt_in === true,
      sms_consent_version: pending.sms_consent_version || null,
      preferred_channel: pending.sms_opt_in === true ? 'sms' : 'email',
    };

    await admin.from("pending_signups").delete().eq("id", pending.id);
    await admin.from("otp_verifications").delete().eq("phone", phone);

    try {
      await upsertBrevoContact({
        email: pending.email,
        phone,
        fullName: pending.full_name,
        dateOfBirth: pending.date_of_birth,
      });
    } catch (e) {
      console.warn("Brevo contact sync failed", e);
    }

    try {
      const session = await passwordSession(pending.email, password);
      return json({
        session,
        phone_verified: true,
        stripe_customer_id: stripeCustomerId,
        user_id: userId,
        messaging_preference: messagingPreference,
      });
    } catch (e) {
      console.warn("session after create failed", e);
      return json({
        session: null,
        phone_verified: true,
        user_id: userId,
        messaging_preference: messagingPreference,
        message: "Account created. Please sign in with your email or phone and password.",
      });
    }
  }

  // Legacy profile challenge; also atomically checked and consumed above.
  const otp = challenge.record;
  const userId = otp.user_id as string;
  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("id, email, display_name, phone, phone_verified, date_of_birth, stripe_customer_id")
    .eq("id", userId)
    .single();

  if (profErr || !profile) return bad("Account not found.", 404);

  if (profile.phone_verified) {
    await admin.from("otp_verifications").delete().eq("user_id", userId);
    try {
      const session = await passwordSession(profile.email!, password);
      return json({ session, already_verified: true });
    } catch {
      return bad("Phone already verified. Please sign in.", 409);
    }
  }

  let stripeCustomerId = profile.stripe_customer_id as string | null;
  if (!stripeCustomerId && profile.email) {
    stripeCustomerId = await createStripeCustomer({
      email: profile.email,
      name: profile.display_name || "",
      phone,
      userId,
    });
  }

  const { error: updErr } = await admin
    .from("profiles")
    .update({
      phone_verified: true,
      phone,
      stripe_customer_id: stripeCustomerId,
      active: true,
    })
    .eq("id", userId);
  if (updErr) {
    await releaseFailedChallenge(admin, challenge);
    return bad("Could not complete verification. Please try again.", 500);
  }

  await admin.from("otp_verifications").delete().eq("user_id", userId);

  try {
    await upsertBrevoContact({
      email: profile.email || "",
      phone,
      fullName: profile.display_name || "",
      dateOfBirth: profile.date_of_birth,
    });
  } catch (_) {}

  try {
    const session = await passwordSession(profile.email!, password);
    return json({ session, phone_verified: true, stripe_customer_id: stripeCustomerId });
  } catch {
    const anon = anonClient();
    const { data: linkData } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: profile.email!,
    });
    const tokenHash = (linkData as any)?.properties?.hashed_token
      || (linkData as any)?.hashed_token;
    if (tokenHash) {
      const { data: verified } = await anon.auth.verifyOtp({
        type: "magiclink",
        token_hash: tokenHash,
      });
      if (verified?.session) {
        return json({
          session: verified.session,
          phone_verified: true,
          stripe_customer_id: stripeCustomerId,
        });
      }
    }
    return json({
      phone_verified: true,
      session: null,
      message: "Verified. Please sign in with your email or phone and password.",
    });
  }
});
