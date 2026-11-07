// Same shared sender. An opaque verification-session token is required before lookup.
// @ts-ignore
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, authFailureResponse, bad, corsHeaders, json, normalizeUsPhone, accountSmsAllowed, sendSignupOtp } from '../_shared/auth.ts';
import { prepareChallenge, requireVerificationToken, challengeMetadata, deliveryFailure } from '../_shared/auth-security.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return bad('Method not allowed', 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return bad('Invalid JSON body'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('Invalid JSON body');
  const phone = normalizeUsPhone(String(body.phone || ''));
  if (!phone) return bad('Enter a valid US phone number.');
  const admin = adminClient();
  try {
    const token = requireVerificationToken(body.verification_token);
    const challenge = await prepareChallenge(admin, 'resend', { phone }, token);
    const row = challenge.record;
    const optedIn = challenge.kind === 'pending' ? row.sms_opt_in === true : await accountSmsAllowed(admin, row.user_id, phone);
    try {
      const sent = await sendSignupOtp({ email: row.email, phone, code: challenge.code, smsOptIn: optedIn, forceEmail: body.delivery_channel === 'email' });
      return json({ ...challengeMetadata(challenge), otp_channel: sent.channel });
    } catch { throw deliveryFailure(challenge); }
  } catch (e) { return authFailureResponse(e); }
});
