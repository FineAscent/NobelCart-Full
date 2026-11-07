const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../site.js'), 'utf8');
const paidSource = source.slice(source.indexOf('function isCheckoutPaid('), source.indexOf('// ---- Stripe Checkout wiring ----'));
const pollSource = source.slice(source.indexOf('  async function pollStatus('), source.indexOf('  let checkoutChannel = null;'));
const scaleSource = source.slice(source.indexOf('function scaleKgToUnit('), source.indexOf('// ---- Lightweight modal for weight input'));
const subtotalSource = source.slice(source.indexOf('function getCartLineCents('), source.indexOf('function compactCartItems('));

function polling(response) {
  const intervals = new Map(); let id = 0, removed = 0, signedOut = 0;
  const messages = [];
  const context = {
    checkoutRun: 1, pollTimer: null, CART_KEY: 'cart',
    window: { sb: { functions: { invoke: async () => typeof response === 'function' ? response() : ({ data: response }) }, auth: { signOut: () => signedOut++ } }, location: {} },
    localStorage: { removeItem: () => removed++ }, sessionStorage: { clear() {} },
    renderCart() {}, showHintToast() {}, mountEl: {}, withCart: x => x,
    setStatus: (message) => messages.push(message),
    setInterval(fn) { intervals.set(++id, fn); return id; }, clearInterval(key) { intervals.delete(key); },
    setTimeout() {}, console: { warn() {} }
  };
  vm.createContext(context);vm.runInContext(paidSource + pollSource, context);
  return { context, intervals, messages, removed: () => removed, signedOut: () => signedOut };
}

test('completed but unpaid checkout retains cart and continues polling', async () => {
  const p = polling({ status: 'complete', payment_status: 'unpaid' });
  await p.context.pollStatus('cs_test_1', 1);
  assert.equal(p.removed(), 0);assert.equal(p.signedOut(), 0);assert.equal(p.intervals.size, 1);
});

test('immediate paid checkout clears cart once and stops polling', async () => {
  const p = polling({ status: 'complete', payment_status: 'paid' });
  await p.context.pollStatus('cs_test_1', 1);
  assert.equal(p.removed(), 1);assert.equal(p.signedOut(), 1);assert.equal(p.intervals.size, 0);
});

test('expired checkout retains cart and stops polling', async () => {
  const p = polling({ status: 'expired', payment_status: 'unpaid' });
  await p.context.pollStatus('cs_test_1', 1);
  assert.equal(p.removed(), 0);assert.equal(p.intervals.size, 0);
});

test('old paid response cannot clear the refreshed checkout cart', async () => {
  let finish;
  const p = polling(() => new Promise(resolve => { finish = resolve; }));
  const pending = p.context.pollStatus('cs_test_old', 1);
  p.context.checkoutRun = 2;
  finish({ data: { status: 'complete', payment_status: 'paid' } });
  await pending;
  assert.equal(p.removed(), 0);assert.equal(p.signedOut(), 0);
});

test('successful status lookup resets consecutive network errors', async () => {
  const responses = [{ error: Error('offline') }, { data: { status: 'open', payment_status: 'unpaid' } },
    { error: Error('offline') }, { error: Error('offline') }, { error: Error('offline') }];
  const p = polling(() => responses.shift());
  await p.context.pollStatus('cs_test_1', 1);
  const tick = [...p.intervals.values()][0];
  await tick();await tick();await tick();
  assert.equal(p.intervals.size, 1);
  await tick();assert.equal(p.intervals.size, 0);
});

test('scale converts kilograms into the product pricing unit', () => {
  const context = {};vm.runInNewContext(scaleSource, context);
  assert.ok(Math.abs(context.scaleKgToUnit(1, 'lb') - 2.2046226218) < 1e-9);
  assert.equal(context.scaleKgToUnit(0.5, 'g'), 500);
  assert.equal(context.scaleKgToUnit(0.5, 'kg'), 0.5);
  assert.ok(Math.abs(context.scaleKgToUnit(1, '/lbs') - 2.2046226218) < 1e-9);
});

test('cart totals round each weighted line to the cents charged by Stripe', () => {
  const items = [{ price: 1, qty: 0.005, weighted: true }, { price: 1, qty: 0.005, weighted: true }];
  const context = { loadCart: () => items };vm.runInNewContext(subtotalSource, context);
  assert.equal(context.getCartSubtotal(), 0.02);
});

test('weighted Stripe receipt preserves actual weight and catalog product ID', async () => {
  const { receiptLine } = await import('../../supabase/functions/_shared/receipt-line.mjs');
  const line = receiptLine({ quantity: 1, amount_total: 2645, description: 'Ground beef', price: { unit_amount: 2645,
    product: { id: 'prod_stripe', metadata: { id: 'catalog-1', weighted: '1', unit: 'lb', qty: '5', unit_price_cents: '529' } } } });
  assert.equal(line.quantity, 5);assert.equal(line.amount_cents, 529);assert.equal(line.total_cents, 2645);
  assert.equal(line.product_id, 'catalog-1');assert.equal(line.is_weighted, true);assert.equal(line.unit, 'lb');
});

test('receipt page never clears an unpaid cart', async () => {
  const block = source.slice(source.indexOf('// Receipt page: fetch session details'), source.indexOf('// --- Inactivity Timer'));
  let init, clearCount = 0;const status = { style: {} };
  const context = {
    location: { pathname: '/receipt.html', search: '?session_id=cs_test_1' }, URLSearchParams,
    document: { body: { classList: { contains: () => true } }, getElementById: () => status, addEventListener: (_, fn) => { init = fn; } },
    window: { sb: { functions: { invoke: async () => ({ data: { status: 'complete', payment_status: 'unpaid' } }) } } },
    saveCart: () => clearCount++, renderCart() {}, console
  };
  context.window.location = context.location;
  vm.runInNewContext(paidSource + block, context);init();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(clearCount, 0);assert.match(status.textContent, /not been confirmed/);
});
