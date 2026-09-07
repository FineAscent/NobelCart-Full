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
  OTP_MAX_ATTEMPTS,
  passwordSession,
  sha256Hex,
  upsertBrevoContact,
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
  const expect = await sha256Hex(`${phone}:${code}`);

  // ---------- Path A: pending signup (preferred — no auth user yet) ----------
  const { data: pending } = await admin
    .from("pending_signups")
    .select("*")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pending) {
    if (new Date(pending.expires_at).getTime() < Date.now()) {
      await admin.from("pending_signups").delete().eq("id", pending.id);
      return bad("Code expired. Start signup again.", 410);
    }
    if ((pending.attempts || 0) >= OTP_MAX_ATTEMPTS) {
      await admin.from("pending_signups").delete().eq("id", pending.id);
      return bad("Too many attempts. Start signup again.", 429);
    }
    if (expect !== pending.code_hash) {
      await admin
        .from("pending_signups")
        .update({ attempts: (pending.attempts || 0) + 1 })
        .eq("id", pending.id);
      return bad("Invalid code.", 401);
    }

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
        await admin.auth.admin.deleteUser(userId);
      } catch (_) {}
      return bad(profErr.message || "Failed to save profile.", 500);
    }

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
      });
    } catch (e) {
      console.warn("session after create failed", e);
      return json({
        session: null,
        phone_verified: true,
        user_id: userId,
        message: "Account created. Please sign in with your email or phone and password.",
      });
    }
  }

  // ---------- Path B: legacy unverified profile (signin recovery) ----------
  const { data: otp } = await admin
    .from("otp_verifications")
    .select("*")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!otp) return bad("No verification code found. Request a new code.", 404);

  if (new Date(otp.expires_at).getTime() < Date.now()) {
    await admin.from("otp_verifications").delete().eq("id", otp.id);
    return bad("Code expired. Request a new code.", 410);
  }
  if ((otp.attempts || 0) >= OTP_MAX_ATTEMPTS) {
    return bad("Too many attempts. Request a new code.", 429);
  }
  if (expect !== otp.code_hash) {
    await admin
      .from("otp_verifications")
      .update({ attempts: (otp.attempts || 0) + 1 })
      .eq("id", otp.id);
    return bad("Invalid code.", 401);
  }

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
  if (updErr) return bad(updErr.message || "Failed to verify phone.", 500);

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
