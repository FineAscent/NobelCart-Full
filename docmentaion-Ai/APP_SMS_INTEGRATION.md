# App signup: optional SMS

The app uses the same Supabase auth functions as the kiosk. Backend changes are local until migrations and functions are deployed. App screens are maintained outside this repository; the app developer must implement the following.

## App UI and requests

1. Fetch `GET https://pkofxkcbdyqcunwjrnnx.supabase.co/functions/v1/auth-signup?action=sms-consent` with the public Supabase `apikey` header. Never ship a service-role key. Read the `sms_consent` object.
2. Show a small switch labeled `Text me updates (optional)`, initially **off**. Present the returned `disclosure` and accessible SMS Terms / Privacy links before signup. Use the absolute `sms_terms_url` and `privacy_policy_url` returned by the API: [SMS Terms](https://fineascent.org/noblecart/sms-terms/) and [Privacy Policy](https://fineascent.org/noblecart/privacy-policy/). The owner confirmed these public pages are published. The legacy relative path fields remain for compatibility; new apps should use the absolute URL fields. For app configuration before the updated API is deployed, use these same public URLs directly. Do not substitute shortened disclosure text silently.
3. Submit the existing signup fields plus the actual boolean choice and the version shown:

```js
const { data, error } = await sb.functions.invoke('auth-signup', {
  body: {
    full_name, date_of_birth, phone, email, password,
    client_type: 'app',
    sms_opt_in: smsSwitchIsOn === true,
    sms_consent_version: displayedSmsConsent.version,
  },
});
```

Signing up and purchasing must work with the switch off. Do not infer agreement from entering a phone number, accepting general terms, or tapping Sign up. Clear the switch if the signup phone number changes. If metadata cannot load, allow signup with SMS off; do not offer an opt-in using unknown/stale wording.

4. On success, store the returned `pending_id`, normalized `phone`, `email`, and `expires_at`. Render the OTP destination using **`otp_channel`**, which is the actual selected delivery route (`sms` or `email`). An opted-in user can receive email when the SMS sender is unavailable or rejects the send. Do not assume the switch value determines where the code went.
5. On `SMS_CONSENT_VERSION_MISMATCH` (HTTP 400), use the error body's refreshed `sms_consent`, reset the switch off, and ask the user to review and choose again. Supabase's non-2xx payload is available from `await error.context.json()`; it may not be in `data`. Never automatically opt the user back in or silently retry true with a new version. `INVALID_CLIENT_TYPE` means the developer must fix the submitted client type.
6. Verify with `auth-verify-otp` and `{ phone, code, password }`. The server saves the consent snapshot with `source: "app_signup"`; no separate consent-write request is needed. New-signup responses include `messaging_preference: { sms_opt_in, sms_consent_version, preferred_channel }`. This is a preference, not proof of delivery. Use `sb.auth.setSession` only when both tokens are returned; if `session` is null, show the returned message and offer sign-in.

## Resend, changes, and sign-in

- Resend: `auth-resend-otp` with `{ phone }`; respect the 60-second cooldown and use the new `otp_channel`.
- Offer **Use email instead** while the current channel is SMS: resend with `{ phone, delivery_channel: "email" }`. This overrides that delivery, without revoking the saved SMS preference. Keep this field on later resends while the user wants email.
- Wrong number: `auth-update-phone` with `{ pending_id, phone }`. A changed number clears pending consent and uses email. To opt in for the corrected number, restart signup after showing the choice again. Do not transfer consent automatically.
- Sign-in can return HTTP 403 with `needs_otp: true` and `otp_channel`; show verification rather than treating that response as a wrong password. A delivery failure may also return `needs_otp` without a channel: show its error and allow retry, without claiming a code was sent.
- Existing apps that omit SMS fields continue on email. No existing customer is opted in by this release. General policy acceptance remains separate from optional SMS consent.

## Messaging behavior and deployment

Opt-in prefers SMS for verification, account/security, and order confirmation messages covered by this program. It does not enroll promotional messages. Missing consent, a changed number, missing SMS configuration, or immediate SMS send failure uses email. Later carrier delivery failures are not automatically rerouted. Provider opt-out blocklists must remain enforced; the app must never clear them.

Apply migrations `0025_signup_sms_consent.sql`, `0026_receipt_sms_delivery.sql`, and `0027_app_signup_consent_source.sql`; deploy the updated auth functions, shared code, and `send-checkout-email`. Publish the frontend legal pages before enabling the app switch. Configure the approved Brevo sender and `OTP_CHANNEL=auto`; `OTP_CHANNEL=email` forces email. Sender approval and STOP/HELP handling are separate provider setup tasks. See [rollout checklist](SMS_PREFERENCE_ROLLOUT.md).

Before release, test declined and accepted consent, stale version, absent metadata, SMS-to-email fallback, resends, phone correction, verification/session creation, and a test order confirmation. No live messages are sent by the local automated tests.

## Public legal URL configuration

```js
const SMS_TERMS_URL = "https://fineascent.org/noblecart/sms-terms/";
const PRIVACY_POLICY_URL = "https://fineascent.org/noblecart/privacy-policy/";
```

These URLs resolve the missing-legal-page configuration blocker. Enable the app SMS feature flag after confirming the updated backend is deployed and the sender/STOP/HELP setup is ready; the customer switch must still start off.
