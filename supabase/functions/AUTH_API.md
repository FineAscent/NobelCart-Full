# React / phone-app auth contract

Same Edge Functions as the kiosk. `verify_jwt = false` on these auth functions.

## Deploy

```bash
supabase functions deploy auth-signup auth-verify-otp auth-update-phone auth-resend-otp auth-signin --no-verify-jwt
```

Apply migrations through `0028_auth_challenge_security.sql` before deploying. Coordinate updated web/native clients first; tokenless older clients must update and restart verification. See [security rollout](../../docmentaion-Ai/AUTH_SECURITY_ROLLOUT.md). Nothing in this working tree has been deployed. See [app SMS integration](../../docmentaion-Ai/APP_SMS_INTEGRATION.md) for UI, payload, fallback, and rollout requirements. These local changes must be deployed before the app uses them.

## Signup flow (app)

1. Collect: full name, DOB (`YYYY-MM-DD`), US phone, email, password (7+ letters/numbers only)
2. Fetch `GET auth-signup?action=sms-consent`; display its optional SMS choice, initially off, and disclosure/links.
3. `auth-signup` with `client_type: "app"`, `sms_opt_in` and the displayed `sms_consent_version` → sends OTP. Opt-in prefers SMS; otherwise email. Always follow returned `otp_channel`.
4. User enters 6-digit code
5. Keep returned `verification_token` in memory. Call `auth-verify-otp` with `{ phone, code, password, verification_token }` → returns `session`
6. If session tokens are present, `sb.auth.setSession(session)`; otherwise show the returned sign-in message.

Optional:
- Wrong number before verify → `auth-update-phone` with `{ pending_id, phone, verification_token }`
- Resend code → `auth-resend-otp` with `{ phone, verification_token }`

## Sign-in flow (app)

1. `auth-signin` with `{ identifier: emailOrPhone, password }`
2. If `needs_otp` with `otp_channel` → show OTP UI, then `auth-verify-otp`. Without a channel, show the delivery error and offer retry.
3. Otherwise, when session tokens are present, `sb.auth.setSession(data.session)`
4. Public credential failures use the same generic message. Do not infer account existence from a failure.
5. Keep `verification_token` from password-proven `needs_otp` responses for verify/resend; no pending IDs are exposed by sign-in.

## QR kiosk login (after app user is signed in)

Kiosk QR encodes `cart_id`. App (logged-in) calls:

```js
await sb.functions.invoke('qr-cart-approve', {
  body: { cart_id },
  // Authorization: Bearer <user access_token> is attached by supabase-js automatically
})
```

Kiosk picks up approval via Realtime / poll and signs in with `token_hash`.

---

## Copy-paste helper (React / Expo)

```js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pkofxkcbdyqcunwjrnnx.supabase.co';
const SUPABASE_ANON_KEY = '<anon key from config.js>';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function invokeAuth(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  let payload = data;
  if ((!payload || payload.error) && error) {
    try {
      if (typeof error.context?.json === 'function') {
        payload = await error.context.json();
      }
    } catch (_) {}
  }
  if (payload?.needs_otp && payload?.verification_token) return payload;
  if (payload?.error) {
    const err = new Error(payload.error);
    err.payload = payload;
    throw err;
  }
  if (error) throw error;
  return payload || {};
}

/** Normalize display phone → E.164 (+1…) before calling APIs if you want; server also normalizes. */
export async function signupStart({ full_name, date_of_birth, phone, email, password, sms_opt_in = false, sms_consent_version, verification_token }) {
  // date_of_birth: 'YYYY-MM-DD'
  return invokeAuth('auth-signup', {
    client_type: 'app',
    verification_token, // only for edits to a signup you already own
    sms_opt_in: sms_opt_in === true,
    sms_consent_version,
    full_name,
    date_of_birth,
    phone,
    email,
    password,
  });
  // → { pending_id, verification_token, phone, email, expires_at, otp_channel }
}

export async function signupVerify({ phone, code, password, verification_token }) {
  const data = await invokeAuth('auth-verify-otp', { phone, code, password, verification_token });
  if (data.session?.access_token && data.session?.refresh_token) {
    await sb.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  }
  return data;
}

export async function signupResend(phone, verification_token, useEmail = false) {
  return invokeAuth('auth-resend-otp', { phone, verification_token, ...(useEmail ? { delivery_channel: 'email' } : {}) });
}

export async function signupChangePhone({ pending_id, phone, verification_token }) {
  return invokeAuth('auth-update-phone', { pending_id, phone, verification_token });
}

export async function signIn(identifier, password) {
  const data = await invokeAuth('auth-signin', { identifier, password });
  if (data.needs_otp) return data; // show OTP, then signupVerify
  if (data.session?.access_token && data.session?.refresh_token) {
    await sb.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  }
  return data;
}

/** After scanning kiosk QR that contains cart_id */
export async function approveKioskQr(cart_id) {
  return invokeAuth('qr-cart-approve', { cart_id });
  // user must already be signed in (JWT on the client)
}
```

## Endpoint cheat sheet

| Function | Body | Success |
|---|---|---|
| `auth-signup` GET | `?action=sms-consent` | `{ sms_consent: { version, label, optional, default_opt_in, disclosure, purposes, privacy_policy_url, sms_terms_url, privacy_policy_path, sms_terms_path } }` |
| `auth-signup` POST | `{ full_name, date_of_birth, phone, email, password, client_type: "app", sms_opt_in, sms_consent_version }` | `{ pending_id, verification_token, phone, email, expires_at, otp_channel, sms_opt_in, sms_consent_version, signup_source }` |
| `auth-verify-otp` | `{ phone, code, password, verification_token }` | `{ session, messaging_preference }` (new signup); session may be null: show returned sign-in message |
| `auth-resend-otp` | `{ phone, verification_token, delivery_channel?: "email" }` | `{ expires_at, otp_channel, … }` |
| `auth-update-phone` | `{ pending_id, phone, verification_token }` | updated pending + new OTP |
| `auth-signin` | `{ identifier, password }` | `{ session }` or password-proven `{ needs_otp, verification_token, … }`; generic 401 for invalid credentials |
| `qr-cart-approve` | `{ cart_id }` + user JWT | `{ success: true }` |

## Password rules

- Min 7 chars
- Letters and numbers only (no spaces/symbols)

## Phone rules

- US only → stored as `+1XXXXXXXXXX`
