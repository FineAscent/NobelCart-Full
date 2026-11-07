# Optional SMS defaults

Customers who opt in during signup prefer SMS for verification, security, and purchase notifications. Email remains the route for declined/missing consent and for failed/unavailable SMS sends. No promotional messaging is enrolled.

Consent is restricted to the recorded number and program version. Editing a pending signup's phone clears its consent; changing a profile's phone does not transfer old consent to the new number. Older verification-only consent does not authorize purchase messages.

## Deployment order

1. Apply migrations `0025_signup_sms_consent.sql` , `0026_receipt_sms_delivery.sql`, and `0027_app_signup_consent_source.sql`.
2. Deploy `auth-signup`, `auth-verify-otp`, `auth-signin`, `auth-resend-otp`, `auth-update-phone`, and `send-checkout-email` with their shared dependencies. Existing checkout corrections separately require the updated Stripe functions.
3. Publish the signup, sign-in, receipt, policy, and shared frontend changes, including `privacy.html` and `sms-terms.html`. Update the public business website's policy/terms links used in carrier registration as appropriate.
4. After Brevo approves the sender, configure `BREVO_API_KEY`, the registered `BREVO_SMS_SENDER`, and `OTP_CHANNEL=auto`. `OTP_CHANNEL=email` is the email-only rollback switch. Missing SMS configuration also keeps delivery on email.
5. Confirm Brevo's STOP/HELP handling and opt-out blocklisting for the registered sender before sending live texts. Never clear a provider blocklist automatically. This change does not register or approve a sender or configure its inbound keyword handling.

## Verification

Run `node --test scripts/tests/*.test.js`. In a test environment, exercise opt-in/decline, code resend, Use email instead, SMS rejection followed by email fallback, phone edits, and duplicate receipt callbacks. Confirm SMS destination matches the stored consent number. No real SMS is sent by the automated tests.

Receipt SMS is requested only by the receipt owner or service role and uses stored receipt totals and stored phone numbers. A receipt claim prevents concurrent webhook/page requests from sending duplicate text confirmations. A successful SMS skips the email notification; a failed SMS falls back to the existing email path. "Accepted by sender" does not guarantee carrier delivery; later delivery failures are not automatically rerouted by this change.

## Mobile app

The app shares these auth functions. Follow [APP_SMS_INTEGRATION.md](APP_SMS_INTEGRATION.md) before releasing its opt-in UI. Fetch current disclosure/version, send `client_type: "app"`, and follow the returned OTP channel. Older clients without consent fields continue using email; they are not enrolled automatically.

Public legal pages (publication confirmed by the owner): [SMS Terms](https://fineascent.org/noblecart/sms-terms/) and [Privacy Policy](https://fineascent.org/noblecart/privacy-policy/). App metadata now includes absolute `sms_terms_url` and `privacy_policy_url`; use these instead of resolving legacy relative paths on Render.
