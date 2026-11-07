export const SMS_CONSENT_VERSION = '2026-10-21.2';
export const SMS_CONSENT_TEXT = 'By opting in, you agree to automated verification, account and order texts from NobleCart by FineAscent LLC. Not required to sign up or buy. Message frequency varies. Message and data rates may apply. Reply STOP to cancel or HELP for help. Your mobile information is not sold or shared for marketing.';

export function captureSmsConsent(optIn, version, now = new Date().toISOString()) {
  // Old clients, absent fields, and string values must never enroll a customer.
  if (optIn !== true) return { sms_opt_in: false, sms_consent_version: null, sms_consent_text: null, sms_consent_at: null };
  if (version !== SMS_CONSENT_VERSION) throw new Error('Please refresh signup to review the current SMS terms.');
  return { sms_opt_in: true, sms_consent_version: SMS_CONSENT_VERSION,
    sms_consent_text: SMS_CONSENT_TEXT, sms_consent_at: now };
}

// Consent belongs to a specific number and message purpose, not just an account.
export function canSendSms(consent, phone, purpose = 'account') {
  if (consent?.opted_in !== true || !phone || consent.phone !== phone) return false;
  if (purpose === 'order') return [SMS_CONSENT_VERSION, '2026-10-21.1'].includes(consent.consent_version);
  return [SMS_CONSENT_VERSION, '2026-10-21.1', '2026-10-21'].includes(consent.consent_version);
}

export function preferredChannel(optedIn, smsReady, forceEmail = false) {
  return optedIn === true && smsReady && !forceEmail ? 'sms' : 'email';
}

export async function deliverPreferredMessage(options, senders) {
  if (preferredChannel(options.optedIn, options.smsReady, options.forceEmail) === 'sms') {
    try { return { ...await senders.sms(), channel: 'sms' }; }
    catch (error) { if (senders.onSmsError) senders.onSmsError(error); }
  }
  return { ...await senders.email(), channel: 'email' };
}

// Public signup metadata: no account details or sender credentials are exposed.
export function smsConsentForm() {
  return {
    version: SMS_CONSENT_VERSION,
    label: 'Text me updates',
    optional: true,
    default_opt_in: false,
    disclosure: SMS_CONSENT_TEXT,
    purposes: ['verification', 'account', 'order'],
    privacy_policy_url: 'https://fineascent.org/noblecart/privacy-policy/',
    sms_terms_url: 'https://fineascent.org/noblecart/sms-terms/',
    // Retained for older clients; new apps should use the public URLs above.
    privacy_policy_path: '/privacy.html',
    sms_terms_path: '/sms-terms.html',
  };
}

export function signupConsentSource(clientType) {
  if (clientType == null || clientType === 'kiosk') return 'kiosk_signup';
  if (clientType === 'app') return 'app_signup';
  throw new Error('client_type must be app or kiosk.');
}
