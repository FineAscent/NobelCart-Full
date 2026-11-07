// Only the owner of a pending verification session can correct its phone number.
// @ts-ignore
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, authFailureResponse, bad, corsHeaders, isPhoneBanned, json, normalizeUsPhone, sendSignupOtp } from '../_shared/auth.ts';
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
    if (!body.pending_id || await isPhoneBanned(admin, phone)) return bad('Unable to update signup.', 400);
    const challenge = await prepareChallenge(admin, 'change_phone', { phone, pending_id: String(body.pending_id) }, token);
    const row = challenge.record;
    try {
      const sent = await sendSignupOtp({ email: row.email, phone, code: challenge.code, smsOptIn: row.sms_opt_in === true });
      return json({ ...challengeMetadata(challenge), otp_channel: sent.channel });
    } catch { throw deliveryFailure(challenge); }
  } catch (e) { return authFailureResponse(e); }
});
