const test = require('node:test');
const assert = require('node:assert/strict');

test('verification safely renders the code inside the approved branded layout', async () => {
  const { verificationEmailHtml } = await import('../../supabase/functions/_shared/verification-email.mjs');
  const html = verificationEmailHtml('123456');
  assert.match(html, /123456/);
  assert.match(html, /expires in 10 minutes/);
  assert.match(html, /noblecart-wordmark-black\.png/);
  assert.match(html, /FineAscent mountain/);
  assert.match(html, /mailto:support@fineascent\.org/);
  assert.doesNotMatch(html, /\{\{ \.ConfirmationURL \}\}/);
  assert.doesNotMatch(verificationEmailHtml('<img src=x>'), /<img src=x>/);
});

test('receipt keeps order quantities, prices and totals and escapes customer content', async () => {
  const { receiptEmailHtml } = await import('../../supabase/functions/_shared/receipt-email.mjs');
  const html = receiptEmailHtml({
    items: [{ product_name: '<img src=x> & Tea', quantity: 2, unit_price_cents: 250, total_price_cents: 500 }],
    totalCents: 500, receiptId: 'receipt<123>', timestamp: 'Nov 5, 2026', currency: 'USD',
  });
  assert.match(html, /&lt;img src=x&gt; &amp; Tea/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /receipt&lt;123&gt;/);
  assert.match(html, />2<\/td>/);
  assert.match(html, /\$2\.50/);
  assert.match(html, /\$5\.00/);
  assert.match(html, /NobleCart by FineAscent/);
  assert.match(html, /mailto:support@fineascent\.org/);
  assert.match(html, /noblecart\/privacy-policy\//);
});

test('receipt amount-based items retain their calculated unit prices', async () => {
  const { receiptEmailHtml } = await import('../../supabase/functions/_shared/receipt-email.mjs');
  const html = receiptEmailHtml({
    items: [{ name: 'Milk', qty: 2, amount_cents: 700 }], totalCents: 700,
    receiptId: 'R-2', timestamp: 'Nov 5, 2026', currency: 'USD',
  });
  assert.match(html, /\$3\.50/);
  assert.match(html, /\$7\.00/);
});
