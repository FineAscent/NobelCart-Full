# React / phone-app auth contract

Same Edge Functions as the kiosk. `verify_jwt = false` on these auth functions.

## Deploy

```bash
supabase functions deploy auth-signup auth-verify-otp auth-update-phone auth-resend-otp auth-signin --no-verify-jwt
```

## Signup flow (app)

1. Collect: full name, DOB (`YYYY-MM-DD`), US phone, email, password (7+ letters/numbers only)
2. `auth-signup` → sends OTP (email channel by default)
3. User enters 6-digit code
4. `auth-verify-otp` with same `phone` + `password` → returns `session`
5. `sb.auth.setSession(session)`

Optional:
- Wrong number before verify → `auth-update-phone` with `{ pending_id, phone }`
- Resend code → `auth-resend-otp` with `{ phone }`

## Sign-in flow (app)

1. `auth-signin` with `{ identifier: emailOrPhone, password }`
2. `sb.auth.setSession(data.session)`
3. If `needs_otp` → show OTP UI, then `auth-verify-otp`
4. If `wrong_password` → show “That password is wrong.”
5. If `not_found` → offer create account

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
  if (payload?.error) {
    const err = new Error(payload.error);
    err.payload = payload;
    throw err;
  }
  if (error) throw error;
  return payload || {};
}

/** Normalize display phone → E.164 (+1…) before calling APIs if you want; server also normalizes. */
export async function signupStart({ full_name, date_of_birth, phone, email, password }) {
  // date_of_birth: 'YYYY-MM-DD'
  return invokeAuth('auth-signup', {
    full_name,
    date_of_birth,
    phone,
    email,
    password,
  });
  // → { pending_id, phone, email, expires_at, otp_channel }
}

export async function signupVerify({ phone, code, password }) {
  const data = await invokeAuth('auth-verify-otp', { phone, code, password });
  if (data.session?.access_token && data.session?.refresh_token) {
    await sb.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  }
  return data;
}

export async function signupResend(phone) {
  return invokeAuth('auth-resend-otp', { phone });
}

export async function signupChangePhone({ pending_id, phone }) {
  return invokeAuth('auth-update-phone', { pending_id, phone });
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
| `auth-signup` | `{ full_name, date_of_birth, phone, email, password }` | `{ pending_id, phone, email, expires_at }` |
| `auth-verify-otp` | `{ phone, code, password }` | `{ session }` |
| `auth-resend-otp` | `{ phone }` | `{ ok / expires_at }` |
| `auth-update-phone` | `{ pending_id, phone }` | updated pending + new OTP |
| `auth-signin` | `{ identifier, password }` | `{ session }` or `{ needs_otp, … }` / `{ wrong_password }` / `{ not_found }` |
| `qr-cart-approve` | `{ cart_id }` + user JWT | `{ success: true }` |

## Password rules

- Min 7 chars
- Letters and numbers only (no spaces/symbols)

## Phone rules

- US only → stored as `+1XXXXXXXXXX`
