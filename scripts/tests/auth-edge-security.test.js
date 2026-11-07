// Execute the real Edge wrappers with mocked database/provider dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { webcrypto } = require('node:crypto');
const ts = require(process.env.NOBLECART_TYPESCRIPT_PATH || 'typescript');
globalThis.crypto = webcrypto;
const root = path.join(__dirname, '../..');
function load(relative, mocks) {
  const filename = path.join(root, relative);
  const compiled = new Module(filename, module);
  compiled.require = name => {
    if (name in mocks) return mocks[name];
    throw Error('Unexpected import: ' + name);
  };
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    reportDiagnostics: true,
  }).outputText, filename);
  return compiled.exports;
}
const security = load('supabase/functions/_shared/auth-security.ts', {});
const shared = load('supabase/functions/_shared/auth.ts', {
  './auth-security.ts': security, './sms-consent.mjs': {}, './verification-email.mjs': {},
  './email-layout.mjs': { SUPPORT_EMAIL: 'support@fineascent.org' },
  'https://esm.sh/@supabase/supabase-js@2': {},
});
function route(name, overrides = {}) {
  let handler;
  load(`supabase/functions/${name}/index.ts`, {
    'https://deno.land/std@0.224.0/http/server.ts': { serve: fn => { handler = fn; } },
    '../_shared/auth.ts': { ...shared, ...overrides }, '../_shared/auth-security.ts': security,
  });
  return async body => handler({ method: 'POST', json: async () => body });
}
const token = 'a'.repeat(64), phone = '+15555550123';

test('session tokens are random, hashed for the database, and excluded from returned records', async () => {
  const calls = [];
  const admin = { rpc: async (name, params) => {
    calls.push({ name, params });
    return { data: { status: 'ok', kind: 'pending', record: { id: 'pending', phone, email: 'local@example.test', code_hash: 'private', verification_token_hash: 'private' } }, error: null };
  } };
  const first = await security.prepareChallenge(admin, 'signup', { phone });
  assert.match(first.verification_token, /^[a-f0-9]{64}$/);
  assert.match(first.code, /^\d{6}$/);
  assert.notEqual(calls[0].params.p_data.token_hash, first.verification_token);
  assert.notEqual(calls[0].params.p_data.code_hash, first.code);
  const metadata = security.challengeMetadata(first);
  assert.equal(metadata.verification_token, first.verification_token);
  assert.equal(metadata.code_hash, undefined); assert.equal(metadata.verification_token_hash, undefined);
  const edited = await security.prepareChallenge(admin, 'signup', { phone }, first.verification_token);
  assert.notEqual(edited.verification_token, first.verification_token);
  assert.equal(calls[1].params.p_data.supplied_token_hash, calls[0].params.p_data.token_hash);
});

test('RPC failures fail closed and rate limits retain HTTP status and retry delay', async () => {
  const admin = { rpc: async () => ({ data: null, error: { message: 'private database detail' } }) };
  await assert.rejects(security.prepareChallenge(admin, 'signup', { phone }), e => e.status === 503 && !e.message.includes('private'));
  admin.rpc = async () => ({ data: { status: 'limited', retry_after: 120 }, error: null });
  let failure;
  try { await security.prepareChallenge(admin, 'signup', { phone }); } catch (e) { failure = e; }
  const response = shared.authFailureResponse(failure);
  assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '120');
  assert.equal((await response.json()).retry_after, 120);
});

test('verify and resend reject callers without a token before any database operation', async () => {
  const admin = { rpc: () => assert.fail('No database operation expected'), from: () => assert.fail('No direct table read expected') };
  const overrides = { adminClient: () => admin };
  for (const name of ['auth-verify-otp', 'auth-resend-otp', 'auth-update-phone']) {
    const response = await route(name, overrides)({ phone, code: '123456', password: 'Example123', pending_id: 'public-id' });
    assert.equal(response.status, 400);
    assert.doesNotMatch(JSON.stringify(await response.json()), /local@example|code_hash/);
  }
});

test('valid-looking but wrong tokens disclose no account records', async () => {
  const admin = { rpc: async () => ({ data: { status: 'invalid_session' }, error: null }), from: () => assert.fail('No direct table read expected') };
  for (const name of ['auth-verify-otp', 'auth-resend-otp']) {
    const response = await route(name, { adminClient: () => admin })({ phone, code: '123456', password: 'Example123', verification_token: token });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.pending_id, undefined); assert.equal(payload.email, undefined); assert.equal(payload.user_id, undefined);
  }
});

test('signin returns the same public failure for absent, pending and wrong-password accounts', async () => {
  const profile = { id: 'user-id', email: 'local@example.test', phone, phone_verified: true, active: true };
  const outputs = [];
  for (const value of [null, profile, { ...profile, phone_verified: false }]) {
    const tables = [];
    const admin = { from(table) { tables.push(table); return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: value }; } }; } };
    const response = await route('auth-signin', { adminClient: () => admin, isPhoneBanned: async () => false, passwordSession: async () => { throw Error('wrong'); } })({ identifier: 'local@example.test', password: 'wrong' });
    assert.equal(response.status, 401); outputs.push(await response.json()); assert.deepEqual(tables, ['profiles']);
  }
  assert.deepEqual(outputs[0], outputs[1]);
  assert.deepEqual(outputs[0], outputs[2]);
  assert.equal(outputs[0].pending_id, undefined); assert.equal(outputs[0].not_found, undefined);
});

test('provider failure retains only the owners retry metadata and does not claim delivery', async () => {
  const challenge = { kind: 'pending', verification_token: token, record: { id: 'pending', phone, email: 'local@example.test', code_hash: 'private' } };
  const response = shared.authFailureResponse(security.deliveryFailure(challenge));
  const payload = await response.json();
  assert.equal(response.status, 502); assert.equal(payload.verification_token, token);
  assert.equal(payload.needs_otp, true); assert.equal(payload.retry_after, 60);
  assert.equal(payload.otp_channel, undefined); assert.equal(payload.code_hash, undefined);
});

test('browser signup and signin keep the secret in memory and pass it to shared endpoints', () => {
  const source = fs.readFileSync(path.join(root, 'signup-steps.js'), 'utf8');
  const start = source.indexOf('      async function invokeAuth('), end = source.indexOf('      function showError(', start);
  const wrapper = source.slice(start, end);
  const vm = require('node:vm');
  const calls = [];
  const context = { verificationToken: '', window: { sb: { functions: { invoke: async (name, options) => {
    calls.push({ name, ...options }); return { data: { verification_token: token } };
  } } } } };
  vm.runInNewContext(wrapper, context);
  return (async () => {
    await context.invokeAuth('auth-signup', { sms_opt_in: false });
    await context.invokeAuth('auth-resend-otp', { phone });
    assert.equal(calls[1].body.verification_token, token);
    const signin = fs.readFileSync(path.join(root, 'signin.html'), 'utf8');
    assert.match(signin, /verification_token: pendingVerificationToken/);
    assert.doesNotMatch(wrapper, /localStorage|sessionStorage/);
  })();
});

test('verification creates one account only after the atomic RPC and retains requested phone behavior', async () => {
  let checked = false, created = 0, profile;
  const row = { id: 'pending', email: 'local@example.test', phone, full_name: 'Local Test', date_of_birth: '2000-01-01', sms_opt_in: false, signup_source: 'app_signup' };
  const admin = {
    rpc: async name => { assert.equal(name, 'auth_check_challenge'); const data = checked ? { status: 'invalid_session' } : { status: 'ok', kind: 'pending', record: row }; checked = true; return { data, error: null }; },
    auth: { admin: { createUser: async attributes => { assert.equal(checked, true); created++; assert.equal(attributes.email_confirm, true); return { data: { user: { id: 'local-user' } }, error: null }; } } },
    from(table) { return { upsert(values) { if (table === 'profiles') profile = values; return this; }, insert() { return this; }, delete() { return this; }, eq() { return this; }, then(resolve) { resolve({ error: null }); } }; },
  };
  const invoke = route('auth-verify-otp', { adminClient: () => admin, createStripeCustomer: async () => null, upsertBrevoContact: async () => {}, passwordSession: async () => ({ access_token: 'local-mock' }) });
  const body = { phone, code: '123456', password: 'Example123', verification_token: token };
  assert.equal((await invoke(body)).status, 200);
  assert.equal(profile.phone_verified, true);
  assert.equal((await invoke(body)).status, 400);
  assert.equal(created, 1);
});

test('failed account creation releases consumption without resetting attempts or hourly budgets', async () => {
  const updates = [];
  const row = { id: 'pending', code_hash: 'private-code', verification_token_hash: 'private-token', email: 'local@example.test' };
  const admin = {
    rpc: async () => ({ data: { status: 'ok', kind: 'pending', record: row }, error: null }),
    auth: { admin: { createUser: async () => ({ data: null, error: { message: 'Please try again.' } }) } },
    from(table) { assert.equal(table, 'pending_signups'); return { update(value) { updates.push(value); return this; }, eq() { return this; }, then(resolve) { resolve({ error: null }); } }; },
  };
  const response = await route('auth-verify-otp', { adminClient: () => admin })({ phone, code: '123456', password: 'Example123', verification_token: token });
  assert.equal(response.status, 400);
  assert.deepEqual(updates, [{ consumed_at: null }]);
});
