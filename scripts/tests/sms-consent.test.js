const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('app metadata uses the same disclosure and starts with optional SMS off', async () => {
  const { smsConsentForm, SMS_CONSENT_VERSION, SMS_CONSENT_TEXT, captureSmsConsent } = await import('../../supabase/functions/_shared/sms-consent.mjs');
  const form = smsConsentForm();
  assert.equal(form.version, SMS_CONSENT_VERSION);
  assert.equal(form.disclosure, SMS_CONSENT_TEXT);
  assert.equal(form.optional, true);
  assert.equal(form.default_opt_in, false);
  assert.deepEqual(form.purposes, ['verification', 'account', 'order']);
  assert.equal(form.privacy_policy_url, 'https://fineascent.org/noblecart/privacy-policy/');
  assert.equal(form.sms_terms_url, 'https://fineascent.org/noblecart/sms-terms/');
  assert.equal(captureSmsConsent(true, form.version).sms_opt_in, true);
  for (const target of [form.privacy_policy_path, form.sms_terms_path]) {
    assert.ok(target.startsWith('/'));
    assert.ok(fs.existsSync(path.join(root, target.slice(1))));
  }
  form.version = 'client-change';
  assert.equal(smsConsentForm().version, SMS_CONSENT_VERSION);
});

test('app consent source is explicit and older clients keep the existing source', async () => {
  const { signupConsentSource } = await import('../../supabase/functions/_shared/sms-consent.mjs');
  assert.equal(signupConsentSource('app'), 'app_signup');
  assert.equal(signupConsentSource('kiosk'), 'kiosk_signup');
  assert.equal(signupConsentSource(undefined), 'kiosk_signup');
  for (const value of ['APP', 'website', true, {}]) {
    assert.throws(() => signupConsentSource(value), /client_type/);
  }
});

test('SMS opt-in is never inferred from omitted or truthy string fields', async () => {
  const { captureSmsConsent, SMS_CONSENT_VERSION } = await import('../../supabase/functions/_shared/sms-consent.mjs');
  for (const value of [undefined, null, false, 'true', 'false', 1]) {
    const captured = captureSmsConsent(value, SMS_CONSENT_VERSION);
    assert.equal(captured.sms_opt_in, false);
    assert.equal(captured.sms_consent_at, null);
  }
});

test('explicit opt-in snapshots current server disclosure with server timestamp', async () => {
  const { captureSmsConsent, SMS_CONSENT_VERSION, SMS_CONSENT_TEXT } = await import('../../supabase/functions/_shared/sms-consent.mjs');
  const record = captureSmsConsent(true, SMS_CONSENT_VERSION, '2026-10-21T12:00:00.000Z');
  assert.equal(record.sms_opt_in, true);
  assert.equal(record.sms_consent_text, SMS_CONSENT_TEXT);
  assert.equal(record.sms_consent_version, SMS_CONSENT_VERSION);
  assert.equal(record.sms_consent_at, '2026-10-21T12:00:00.000Z');
  assert.throws(() => captureSmsConsent(true, 'old-policy'), /refresh signup/);
});

test('displayed signup disclosure matches the saved consent text exactly', async () => {
  const { SMS_CONSENT_TEXT, SMS_CONSENT_VERSION } = await import('../../supabase/functions/_shared/sms-consent.mjs');
  const html = read('create-account.html');
  const disclosure = html.match(/<p id="signup-sms-disclosure">([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  assert.equal(disclosure, SMS_CONSENT_TEXT);
  const checkbox = html.match(/<input type="checkbox" id="signup-sms-opt-in"[\s\S]*?\/>/)[0];
  assert.doesNotMatch(checkbox, /\b(?:checked|required)\b/);
  assert.match(checkbox, new RegExp(SMS_CONSENT_VERSION));
  for (const filename of ['privacy.html', 'sms-terms.html']) assert.ok(fs.existsSync(path.join(root, filename)));
});

test('public privacy page matches the policy shown during account acceptance', () => {
  const policy = read('policy-gate.js').match(/const NC_POLICY_HTML = `([\s\S]*?)`;/)[1].trim();
  const publicPolicy = read('privacy.html').match(/<article id="privacy-policy-content">([\s\S]*?)<\/article>/)[1].trim();
  assert.equal(publicPolicy, policy);
  assert.match(policy, /does not enroll you/);
});

test('SMS choice is independent of the required signup confirmation rows', () => {
  const steps = read('signup-steps.js');
  const gate = steps.slice(steps.indexOf('function refreshSummaryConfirm()'), steps.indexOf('function closeSummary()'));
  assert.doesNotMatch(gate, /smsOptIn|sms_opt_in/);
  const resend = read('supabase/functions/auth-resend-otp/index.ts');
  assert.doesNotMatch(resend, /sms_opt_in\s*:\s*true/);
});

test('SMS defaults require consent, a working sender, and no email override', async () => {
  const { preferredChannel } = await import('../../supabase/functions/_shared/sms-consent.mjs');
  assert.equal(preferredChannel(true, true), 'sms');
  assert.equal(preferredChannel(false, true), 'email');
  assert.equal(preferredChannel(true, false), 'email');
  assert.equal(preferredChannel(true, true, true), 'email');
});

test('consent cannot follow a changed number or expand an old program to orders', async () => {
  const { canSendSms, SMS_CONSENT_VERSION } = await import('../../supabase/functions/_shared/sms-consent.mjs');
  const consent = { opted_in: true, phone: '+15555550123', consent_version: SMS_CONSENT_VERSION };
  assert.equal(canSendSms(consent, consent.phone, 'order'), true);
  assert.equal(canSendSms({ ...consent, consent_version: '2026-10-21.1' }, consent.phone, 'order'), true);
  assert.equal(canSendSms(consent, '+15555550124', 'account'), false);
  assert.equal(canSendSms({ ...consent, opted_in: false }, consent.phone), false);
  assert.equal(canSendSms({ ...consent, consent_version: '2026-10-21' }, consent.phone, 'account'), true);
  assert.equal(canSendSms({ ...consent, consent_version: '2026-10-21' }, consent.phone, 'order'), false);
});

test('successful preferred SMS does not also send an email', async () => {
  const { deliverPreferredMessage } = await import('../../supabase/functions/_shared/sms-consent.mjs');
  const calls = [];
  const result = await deliverPreferredMessage({ optedIn: true, smsReady: true }, {
    sms: async () => { calls.push('sms');return { messageId: 'sms-1' }; },
    email: async () => { calls.push('email');return {}; }
  });
  assert.deepEqual(calls, ['sms']);assert.equal(result.channel, 'sms');
});

test('failed SMS sends email and reports the actual delivery channel', async () => {
  const { deliverPreferredMessage } = await import('../../supabase/functions/_shared/sms-consent.mjs');
  const calls = [];
  const result = await deliverPreferredMessage({ optedIn: true, smsReady: true }, {
    sms: async () => { calls.push('sms');throw Error('sender unavailable'); },
    email: async () => { calls.push('email');return { messageId: 'email-1' }; }
  });
  assert.deepEqual(calls, ['sms', 'email']);assert.equal(result.channel, 'email');
});

test('declined consent and explicit email choice never invoke the SMS sender', async () => {
  const { deliverPreferredMessage } = await import('../../supabase/functions/_shared/sms-consent.mjs');
  for (const options of [{ optedIn: false, smsReady: true }, { optedIn: true, smsReady: true, forceEmail: true }]) {
    const result = await deliverPreferredMessage(options, {
      sms: () => assert.fail('SMS must not be sent'), email: async () => ({ messageId: 'email-1' })
    });
    assert.equal(result.channel, 'email');
  }
});

test('verification screen displays the actual SMS or fallback-email destination', () => {
  const vm = require('node:vm');
  const source = read('signup-steps.js');
  const fn = source.slice(source.indexOf('      function updateOtpDestination('), source.indexOf('      function openOtp('));
  const heading = {}, context = {
    pendingPhone: '+15555550123', pendingEmail: 'shopper@example.invalid',
    pendingOtpChannel: 'email', otpHint: {}, otpWrongBtn: {}, otpEmailBtn: {},
    otpOverlay: { querySelector: () => heading }
  };
  vm.runInNewContext(fn, context);
  context.updateOtpDestination('sms');
  assert.match(context.otpHint.textContent, /text to \+15555550123/);
  assert.equal(heading.textContent, 'Verify phone');assert.equal(context.otpEmailBtn.hidden, false);
  context.updateOtpDestination('email');
  assert.match(context.otpHint.textContent, /shopper@example.invalid/);
  assert.equal(heading.textContent, 'Verify email');assert.equal(context.otpEmailBtn.hidden, true);
});
