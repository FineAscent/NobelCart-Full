# Shared auth security hardening — local source only

No database migration, function, web frontend, or native-app release has been
deployed. No accounts or live email/SMS were created by this work.

## Behavior

- One PostgreSQL transaction checks and increments attempts and consumes a valid
  code. An unambiguous account-creation failure releases consumption for retry
  without resetting attempts or hourly counters. Five attempts per code; ten verification requests per phone/email in a
  one-hour window anchored at its first request. New codes do not reset that hour.
- At most five send reservations per phone/email in the same kind of one-hour
  window, at least 60 seconds apart. Signup, signup edits, resends, phone changes,
  and legacy sign-in share this quota. Failed provider sends still count.
- A 256-bit opaque `verification_token` proves ownership of a pending session.
  Only its SHA-256 hash is stored. Verify, resend and phone changes require it.
  Signup edits rotate it; resends retain it. Clients keep it in memory and never
  put it in URLs, persistent browser storage, analytics, or logs.
- A caller without the token cannot replace an unexpired pending signup merely
  by knowing its email, phone or pending ID. Signup no longer deletes unverified
  auth users. The protected scheduled cleanup remains responsible for expiry.
- Invalid sign-in credentials have one public message; no pending ID, account
  existence flag or destination is returned until a password is proven correct.
- SQL RPCs and quota records are service-role only. Missing migration/RPC errors
  fail closed with HTTP 503; no former read/modify/write fallback remains.
- HTTP 429 carries `retry_after` and `Retry-After`. Native resends honor that wait.
  Failed delivery preserves only the owner's retry/session metadata and never
  reports a successful channel. Existing Brevo sender/templates and SMS consent
  remain shared. Current email/phone verification semantics are intentionally
  unchanged at the user's request.

The limits apply per destination, not per IP or every possible identity. They do
not replace any gateway bot/traffic controls. A short database advisory lock
serializes auth challenge mutations only; no email, Stripe, or Auth API network
request happens inside that transaction. PGlite tests execute real PostgreSQL
functions but serialize requests in one local instance; they are not a live
multi-connection load test.

## Coordinated rollout requirement

1. Review/apply migrations through `0028_auth_challenge_security.sql` on the shared
   project. This also extends the existing pending-signup cleanup function to
   prune quota records older than two hours. Confirm its existing schedule runs.
2. Prepare/release the matching `TableUi-App-react/React-App-Ui` client and updated
   `signup-steps.js` and `signin.html`. Make updated app builds available and
   require users of older builds to update before enabling the hardened backend.
   Old clients do not know the token: do not deploy only the new functions and
   assume old native builds will continue verification unchanged. Existing
   tokenless/in-progress sessions must restart on the updated client after their
   existing code expires (up to ten minutes). Active pending records are not
   silently overwritten to make a rollout appear seamless.
3. Deploy all five auth functions with their shared modules together, including
   `_shared/auth-security.ts`. Deploy the matching web assets in the same planned
   rollout. Keep existing shared-email/SMS rollout prerequisites in force.
4. Only with separate authorization, test live signup, invalid codes, hourly
   limits, email fallback, phone correction, legacy sign-in and sender branding.

Previously issued tokens/sessions cannot be migrated from unowned pending IDs.
Do not introduce a token-optional fallback to support old clients.

## Local checks

Install test-only dependencies outside either app (no provider credentials):

```sh
npm install --prefix /tmp/noblecart-auth-test-runtime --ignore-scripts --no-audit --no-fund @electric-sql/pglite typescript
NOBLECART_PGLITE_PATH=/tmp/noblecart-auth-test-runtime/node_modules/@electric-sql/pglite \
NOBLECART_TYPESCRIPT_PATH=/tmp/noblecart-auth-test-runtime/node_modules/typescript \
node --test scripts/tests/auth-security.test.js scripts/tests/auth-edge-security.test.js scripts/tests/customer-email.test.js scripts/tests/sms-consent.test.js scripts/tests/checkout-flow.test.js
```

From TableUi's `React-App-Ui`, run `npm run test:auth`, `npx tsc --noEmit`, and
`npx eslint app/auth.tsx app/lib/authApi.ts scripts/test-auth.cjs`.
All provider and auth-account operations in these tests are mocked.
