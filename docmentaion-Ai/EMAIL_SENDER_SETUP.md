# NobleCart customer email standard

All application email uses `support@fineascent.org`, the existing NobleCart wordmark, FineAscent mountain, approved light layout, support link, and privacy-policy footer. Send through the existing Brevo account. Replies go to the same support address.

## Saved templates

- `_shared/email-layout.mjs`: common header, footer, colors, spacing, and branding. New application emails must use `brandedEmailHtml`; escape customer-supplied values with `escapeEmailHtml`.
- `_shared/verification-email.mjs`: six-digit verification code using the shared layout.
- `_shared/receipt-email.mjs`: receipt details using the same layout.
- `supabase/templates/confirm-signup.html`: Supabase Auth confirmation-link version. Keep every `{{ .ConfirmationURL }}` placeholder intact. Supabase's template editor must use this HTML; SMTP configuration alone does not install the design.

The `_shared` modules live under `supabase/functions`. Auth and receipt functions share `sendBrevoEmail` in `_shared/auth.ts`. Receipt email no longer requires Resend.

## Live configuration

The Brevo sender was verified and Supabase Edge Function sender settings updated to `support@fineascent.org` during setup. The mailbox must remain active to receive replies. `BREVO_API_KEY` is required; do not create a new key just to change email design.

`FROM_EMAIL` is the single application sender setting (defaults to `support@fineascent.org`). `BREVO_OTP_FROM_NAME` preserves the existing display name, defaulting to `NobleCart`. The legacy `BREVO_OTP_FROM_EMAIL` setting no longer overrides the shared sender. Supabase Auth's separate SMTP sender must also remain `support@fineascent.org`.

## Publishing

Before publishing auth security changes, follow [AUTH_SECURITY_ROLLOUT.md](AUTH_SECURITY_ROLLOUT.md): apply migration `0028` and coordinate the token-aware web/native-client rollout. Deploying only the hardened functions will interrupt older clients.

The verification-email HTML was deployed as an isolated change to the four existing auth functions on November 6, 2026; see [deployment record](EMAIL_DESIGN_DEPLOYMENT.md). The rest of the new source has not been deployed. Review the existing SMS rollout requirements before publishing this working tree because it also contains SMS changes. The `send-checkout-email` update and saved link template still require separate activation. Do not put Supabase template placeholders into Brevo API code emails: those messages use the actual generated code.

## Verification

Run `node --test scripts/tests/customer-email.test.js`. Check code and receipt previews at desktop and narrow widths. After deployment, send authorized tests through real signup and receipt flows; verify the From and reply addresses, branding, code expiration, item quantities, prices, totals, and delivery. No live messages are sent by these automated tests. Run the separate SMS and checkout suites as well when those changes are included in a later release.
