// Local PostgreSQL (WASM) only. No Supabase, Brevo, Stripe, or network calls.
// See AUTH_SECURITY_ROLLOUT.md for the temporary test-runtime installation command.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.NOBLECART_PGLITE_PATH || '@electric-sql/pglite');
const root = path.join(__dirname, '../..');
let db;
const token = 'a'.repeat(64), code = 'b'.repeat(64), wrong = 'c'.repeat(64);
const phone = '+15555550123', email = 'local@example.test';
const signup = (extra = {}) => ({ phone, email, full_name: 'Local Test', date_of_birth: '2000-01-01',
  signup_source: 'app_signup', sms_opt_in: false, token_hash: token, supplied_token_hash: null, code_hash: code, ...extra });
async function prepare(action, data) {
  return (await db.query('select public.auth_prepare_challenge($1, $2::jsonb) as result', [action, JSON.stringify(data)])).rows[0].result;
}
async function verify(codeHash = wrong, secret = token) {
  return (await db.query('select public.auth_check_challenge($1, $2, $3) as result', [phone, secret, codeHash])).rows[0].result;
}
async function passCooldown() { await db.exec("update public.auth_hourly_limits set last_at = clock_timestamp() - interval '61 seconds'"); }
async function reset() { await db.exec('truncate public.pending_signups, public.otp_verifications, public.auth_hourly_limits, public.profiles'); }
test.before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.profiles (id uuid primary key, email text, phone text, phone_verified boolean default false, is_admin boolean default false);
    create table public.pending_signups (id uuid primary key default gen_random_uuid(), email text unique not null, phone text unique not null,
      full_name text, date_of_birth date, code_hash text not null, attempts integer not null default 0, expires_at timestamptz not null,
      created_at timestamptz default now(), signup_source text, sms_opt_in boolean default false,
      sms_consent_version text, sms_consent_text text, sms_consent_at timestamptz);
    create table public.otp_verifications (id uuid primary key default gen_random_uuid(), user_id uuid, phone text,
      code_hash text, attempts integer not null default 0, expires_at timestamptz not null, created_at timestamptz default now());
  `);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/0028_auth_challenge_security.sql'), 'utf8'));
});
test.after(async () => { await db?.close(); });
test.beforeEach(reset);

test('concurrent bad guesses stop at five; hourly quota survives resends', async () => {
  assert.equal((await prepare('signup', signup())).status, 'ok');
  const results = await Promise.all(Array.from({ length: 12 }, () => verify()));
  assert.equal(results.filter(r => r.status === 'invalid_code').length, 5);
  assert.equal((await db.query('select attempts from pending_signups')).rows[0].attempts, 5);
  assert(results.slice(5).every(r => ['locked', 'limited'].includes(r.status)));
  await passCooldown();
  assert.equal((await prepare('resend', signup({ supplied_token_hash: token }))).status, 'ok');
  assert.equal((await verify(code)).status, 'limited');
  await db.exec("update public.auth_hourly_limits set started_at = clock_timestamp() - interval '61 minutes'");
  assert.equal((await verify(code)).status, 'ok');
});

test('a correct challenge is consumed once, including concurrent submissions', async () => {
  await prepare('signup', signup());
  const results = await Promise.all(Array.from({ length: 12 }, () => verify(code)));
  assert.equal(results.filter(r => r.status === 'ok').length, 1);
  assert.equal(results.filter(r => r.status === 'invalid_session').length, 11);
});

test('missing, null, wrong and expired session secrets cannot validate or consume quotas', async () => {
  await prepare('signup', signup());
  assert.equal((await verify(code, null)).status, 'invalid_session');
  assert.equal((await verify(null)).status, 'invalid_session');
  assert.equal((await verify(code, wrong)).status, 'invalid_session');
  assert.equal((await prepare('resend', signup({ supplied_token_hash: wrong }))).status, 'invalid_session');
  await db.exec("update pending_signups set expires_at = clock_timestamp() - interval '1 second'");
  assert.equal((await verify(code)).status, 'invalid_session');
  assert.equal((await db.query("select count(*)::integer as n from auth_hourly_limits where bucket like 'verify:%'")).rows[0].n, 0);
});

test('restarting signup cannot replace another session or skip the shared cooldown', async () => {
  const first = await prepare('signup', signup());
  assert.equal((await prepare('signup', signup({ token_hash: wrong }))).status, 'unavailable');
  assert.equal((await prepare('signup', signup({ supplied_token_hash: token }))).status, 'limited');
  const row = (await db.query('select id, code_hash, attempts from pending_signups')).rows[0];
  assert.equal(row.id, first.record.id); assert.equal(row.code_hash, code); assert.equal(row.attempts, 0);
});

test('all issuance routes share five sends per identity per hour, then recover', async () => {
  await prepare('signup', signup());
  for (let n = 1; n < 5; n++) {
    await passCooldown();
    assert.equal((await prepare(n % 2 ? 'resend' : 'signup', signup({ supplied_token_hash: token }))).status, 'ok');
  }
  await passCooldown();
  const blocked = await prepare('resend', signup({ supplied_token_hash: token }));
  assert.equal(blocked.status, 'limited'); assert(blocked.retry_after > 0);
  // An attacker cannot evade the email budget by rotating phone numbers.
  assert.equal((await prepare('signup', signup({ phone: '+15555550124', supplied_token_hash: token }))).status, 'limited');
  await db.exec("update auth_hourly_limits set started_at = clock_timestamp() - interval '61 minutes'");
  assert.equal((await prepare('resend', signup({ supplied_token_hash: token }))).status, 'ok');
});

test('phone corrections require the token and ID, retain quotas, and clear SMS consent', async () => {
  const first = await prepare('signup', signup({ sms_opt_in: true, sms_consent_version: 'v1', sms_consent_text: 'disclosure', sms_consent_at: new Date().toISOString() }));
  const update = { ...signup(), phone: '+15555550124', pending_id: first.record.id, supplied_token_hash: wrong };
  assert.equal((await prepare('change_phone', update)).status, 'invalid_session');
  update.supplied_token_hash = token;
  assert.equal((await prepare('change_phone', update)).status, 'limited');
  await passCooldown();
  const result = await prepare('change_phone', update);
  assert.equal(result.status, 'ok'); assert.equal(result.record.sms_opt_in, false); assert.equal(result.record.sms_consent_version, null);
  assert.equal((await db.query("select requests from auth_hourly_limits where bucket = 'send:email:' || md5($1)", [email])).rows[0].requests, 2);
});

test('legacy challenges use the same session protection, quotas and one-time check', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  await db.query('insert into profiles (id, email, phone) values ($1,$2,$3)', [userId, email, phone]);
  const result = await prepare('legacy', signup({ user_id: userId, supplied_token_hash: token }));
  assert.equal(result.status, 'ok'); assert.equal(result.kind, 'legacy');
  assert.equal((await verify(code, wrong)).status, 'invalid_session');
  assert.equal((await verify(code)).status, 'ok');
  assert.equal((await verify(code)).status, 'invalid_session');
});

test('anonymous and authenticated clients cannot call security-definer auth RPCs', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select public.auth_reserve_limits($1,5,60)', [['test']]), /permission denied/);
    await assert.rejects(db.query('select public.auth_prepare_challenge($1,$2::jsonb)', ['signup', '{}']), /permission denied/);
    await assert.rejects(db.query('select public.auth_check_challenge($1,$2,$3)', [phone, token, code]), /permission denied/);
    await assert.rejects(db.query('select * from public.auth_hourly_limits'), /permission denied/);
    await db.exec('reset role');
  }
});

test('deleting a pending session does not reset budgets; scheduled cleanup preserves active budgets', async () => {
  await prepare('signup', signup());
  await db.exec('delete from pending_signups');
  assert.equal((await prepare('signup', signup())).status, 'limited');
  await passCooldown();
  assert.equal((await prepare('signup', signup())).status, 'ok');
  await db.query("insert into auth_hourly_limits values ('old', clock_timestamp() - interval '3 hours', clock_timestamp() - interval '3 hours', 5)");
  await db.query('select public.cleanup_pending_signups()');
  assert.equal((await db.query("select count(*)::integer as n from auth_hourly_limits where bucket = 'old'")).rows[0].n, 0);
  assert.equal((await db.query("select requests from auth_hourly_limits where bucket = 'send:email:' || md5($1)", [email])).rows[0].requests, 2);
});
