// Server-only challenge reservation. No fallback to the former unlocked queries.
export class AuthFlowError extends Error {
  constructor(message: string, public status = 400, public extra: Record<string, unknown> = {}) { super(message); }
}
const SESSION_ERROR = 'Your verification session expired. Start signup or sign in again.';
export function verificationToken(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}
export function requireVerificationToken(value: unknown): string {
  const token = verificationToken(value);
  if (!token) throw new AuthFlowError(SESSION_ERROR);
  return token;
}
async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}
function newToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
}
function checkResult(data: any, error: unknown) {
  if (error || !data) throw new AuthFlowError('Verification is temporarily unavailable. Please try again.', 503);
  if (data.status === 'limited') {
    const retry = Math.max(1, Number(data.retry_after) || 60);
    const minutes = Math.ceil(retry / 60);
    throw new AuthFlowError(`Please wait ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} before trying again.`, 429, { retry_after: retry });
  }
  if (data.status === 'unavailable') throw new AuthFlowError('Unable to start or update signup. Continue your current verification or try again later.', 409);
  if (data.status === 'locked') throw new AuthFlowError('Too many code attempts. Request a new code when available.', 429);
  if (data.status === 'invalid_code') throw new AuthFlowError('Invalid or expired code.', 401);
  if (data.status !== 'ok') throw new AuthFlowError(SESSION_ERROR);
  return data;
}
// Supabase client is injected for local tests; only service-role callers have RPC permission.
export async function prepareChallenge(admin: any, action: string, details: Record<string, unknown>, supplied?: string) {
  const token = action === 'signup' || !supplied ? newToken() : supplied;
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  const tokenHash = await hash(token);
  const { data, error } = await admin.rpc('auth_prepare_challenge', {
    p_action: action,
    p_data: { ...details, token_hash: tokenHash,
      supplied_token_hash: supplied ? await hash(supplied) : action === 'legacy' ? tokenHash : null,
      code_hash: await hash(`${details.phone}:${code}`) },
  });
  const result = checkResult(data, error);
  return { ...result, code, verification_token: token };
}
export async function checkChallenge(admin: any, phone: string, code: string, token: unknown) {
  const secret = requireVerificationToken(token);
  const { data, error } = await admin.rpc('auth_check_challenge', {
    p_phone: phone, p_token_hash: await hash(secret), p_code_hash: await hash(`${phone}:${code}`),
  });
  return checkResult(data, error);
}
export function challengeMetadata(challenge: any) {
  const row = challenge.record;
  return { phone: row.phone, email: row.email, expires_at: row.expires_at,
    verification_token: challenge.verification_token,
    ...(challenge.kind === 'pending' ? { pending_id: row.id } : {}) };
}
export function deliveryFailure(challenge: any): AuthFlowError {
  return new AuthFlowError('Could not send a verification code. Please try again when available.', 502,
    { ...challengeMetadata(challenge), needs_otp: true, retry_after: 60 });
}
