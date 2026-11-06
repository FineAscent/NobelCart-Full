# Verification email design deployment — November 6, 2026

The user authorized deploying the verification-email design only. Updated live functions in Supabase project `pkofxkcbdyqcunwjrnnx`:

- `auth-signup`
- `auth-resend-otp`
- `auth-signin`
- `auth-update-phone`

Each function's original deployed ZIP was downloaded before editing. Only the `htmlContent` value in its bundled `_shared/auth.ts` was replaced with the approved NobleCart/FineAscent code-email HTML. The full HTML is inlined in these live bundles, retaining `${code}` for the generated OTP. The source of the design remains the local `email-layout.mjs` and `verification-email.mjs` renderers.

Downloaded each function again after deployment and verified that its shared helper exactly matches its reviewed patch and that `src/index.ts` is unchanged. No SMS changes, migrations, receipt-provider changes, website publishing, or Supabase Auth template installation were included. Web and TableUi use these same auth APIs.

The live sender settings were previously updated to `support@fineascent.org`. A post-deployment request through `auth-resend-otp` for the authorized test number returned HTTP 404, “No pending verification for that phone. Start signup again.” No email was sent by that request. Inbox delivery of this deployed code-email design still needs a real pending signup; the earlier Brevo design-preview email was delivered successfully.

Live snapshots and source-comparison results for this deployment were saved under `/tmp/noblecart-live-email-release/`. This temporary folder includes originals, patches, deployed helpers, and `deployment-verification.json`; it contains no API credentials.

The remaining working-tree changes are not deployed. Review the SMS rollout dependencies before any full-source deployment. Receipt design/provider updates and the separate Supabase Auth confirmation-link template remain local.
