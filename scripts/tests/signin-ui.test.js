const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../..');

function node() {
  const classes = new Set(), handlers = {};
  return { handlers, style: { setProperty() {}, removeProperty() {} }, dataset: {}, children: [],
    clientWidth: 400, disabled: false, textContent: '',
    classList: { add: (...items) => items.forEach(x => classes.add(x)),
      remove: (...items) => items.forEach(x => classes.delete(x)), contains: x => classes.has(x) },
    addEventListener(type, handler) { handlers[type] = handler; },
    setAttribute(key, value) { this[key] = value; },
    setPointerCapture() {}, click() { this.handlers.click?.({}); },
    appendChild(child) { this.children.push(child); },
    querySelector(selector) { return selector === 'img' ? this.children[0]?.children[0] : null; },
    querySelectorAll() { return []; },
  };
}

function drag() {
  const bar = node(), email = node(), phone = node(), picks = [];
  bar.dataset.mode = 'email';
  email.handlers.click = () => { picks.push('email'); bar.dataset.mode = 'email'; };
  phone.handlers.click = () => { picks.push('phone'); bar.dataset.mode = 'phone'; };
  const source = fs.readFileSync(path.join(root, 'signin-ui.js'), 'utf8').split('(function () {')[0];
  const context = { setTimeout() {} };
  vm.runInNewContext(source, context);
  context.bindSigninModeDrag(bar, email, phone);
  const pointer = (x, y = 0) => ({ isPrimary: true, button: 0, pointerId: 1, clientX: x, clientY: y });
  return { bar, phone, picks, start: () => bar.handlers.pointerdown(pointer(100)),
    move: (x, y) => bar.handlers.pointermove(pointer(x, y)), end: () => bar.handlers.pointerup(pointer(300)) };
}

test('touch drags select phone and email through the existing mode actions', () => {
  const d = drag();
  d.start(); d.move(280); d.end();
  d.start(); d.move(-80); d.end();
  assert.deepEqual(d.picks, ['phone', 'email']);
});

test('vertical scrolling, cancelled drags, and disabled phone mode never switch', () => {
  const d = drag();
  d.start(); d.move(102, 30); d.end();
  d.start(); d.move(280); d.bar.handlers.pointercancel(); d.end();
  d.phone.disabled = true; d.start(); d.move(280); d.end();
  assert.deepEqual(d.picks, []);
});

function qr() {
  const ids = Object.fromEntries(['qr-signin-btn-top', 'email-signin-tab', 'signin-form', 'qr-app-panel',
    'qr-app-canvas', 'qr-app-msg', 'qr-app-dot', 'qr-scan-help'].map(id => [id, node()]));
  const bar = node(); ids['qr-signin-btn-top'].closest = () => bar;
  ids['qr-app-panel'].style.display = 'none';
  const requests = [], subscriptions = [], timers = [];
  const client = {
    rpc(name, args) { return new Promise(resolve => requests.push({ name, args, resolve })); },
    channel() { const channel = { on() { return channel; }, subscribe() { subscriptions.push(channel); } }; return channel; },
    removeChannel() {},
  };
  const document = { getElementById: id => ids[id] || null, createElement: () => node() };
  const html = fs.readFileSync(path.join(root, 'signin.html'), 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const script = scripts.find(s => s.includes("const QR_RENEW_MS"));
  vm.runInNewContext(script, { document, window: { ncCartId: () => 'test-cart', sb: client, dispatchEvent() {} }, Event: class {},
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    setInterval() { return 1; }, clearInterval() {}, requestAnimationFrame: fn => fn(), Date, encodeURIComponent });
  return { ids, bar, requests, subscriptions,
    phone: () => ids['qr-signin-btn-top'].click(), email: () => ids['email-signin-tab'].click(),
    resolve: async (i = 0) => { requests[i].resolve({ data: [{ id: 'session', expires_at: new Date(Date.now() + 300000).toISOString() }], error: null }); await new Promise(setImmediate); },
  };
}

test('phone selection immediately loads a QR image and starts a session without the guide', async () => {
  const q = qr(); q.phone();
  assert.equal(q.requests[0].name, 'start_cart_qr_session');
  assert.equal(q.requests[0].args.p_cart_id, 'test-cart');
  assert.match(q.ids['qr-app-canvas'].children[0].children[0].src, /data=test-cart$/);
  await q.resolve();
  assert.equal(q.subscriptions.length, 1);
  assert.equal(q.bar.dataset.mode, 'phone');
});

test('switching to email ignores a late QR-session response', async () => {
  const q = qr(); q.phone(); q.email(); await q.resolve();
  assert.equal(q.subscriptions.length, 0);
  assert.equal(q.bar.dataset.mode, 'email');
});

test('rapid phone/email/phone switches only subscribe to the current QR request', async () => {
  const q = qr(); q.phone(); q.email(); q.phone();
  await q.resolve(0); assert.equal(q.subscriptions.length, 0);
  await q.resolve(1); assert.equal(q.subscriptions.length, 1);
});

function transitions(reduced = false) {
  const timers = new Map(); let next = 0;
  const context = { setTimeout() {}, clearTimeout() {} };
  const source = fs.readFileSync(path.join(root, 'signin-ui.js'), 'utf8').split('(function () {')[0];
  vm.runInNewContext(source, context);
  const email = node(), phone = node();
  const change = context.createSigninPanelTransition(email, phone, () => reduced,
    fn => { const id = ++next; timers.set(id, fn); return id; }, id => timers.delete(id));
  return { email, phone, change, timers,
    flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); } };
}

test('reversing a fade restores email without letting an old timer hide it', () => {
  const t = transitions(); t.change('phone');
  assert.equal(t.email.style.opacity, '0');
  t.change('email'); t.flush();
  assert.equal(t.email.style.display, 'flex');
  assert.equal(t.email.style.opacity, '1');
  assert.equal(t.email.inert, false);
  assert.equal(t.phone.style.display, 'none');
});

test('100 rapid reversals keep only the last requested panel interactive', () => {
  const t = transitions();
  for (let i = 0; i < 100; i++) {
    t.change('phone'); if (i % 3 === 0) t.flush();
    t.change('email'); if (i % 4 === 0) t.flush();
    assert.ok(t.timers.size <= 1);
  }
  t.change('phone'); t.flush();
  assert.equal(t.phone.style.display, 'block');
  assert.equal(t.phone.style.opacity, '1');
  assert.equal(t.phone.inert, false);
  assert.equal(t.email.style.display, 'none');
  assert.equal(t.email.inert, true);
});

test('reduced motion settles either panel immediately with no pending animation', () => {
  const t = transitions(true); t.change('phone');
  assert.equal(t.phone.style.opacity, '1'); assert.equal(t.timers.size, 0);
  t.change('email'); assert.equal(t.email.style.opacity, '1'); assert.equal(t.timers.size, 0);
});

function keyboardMotion(reduced = false) {
  const keyboard = node(), motions = [];
  keyboard.style.display = 'block';
  keyboard.animate = (frames, options) => {
    let resolve, reject;
    const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
    const motion = { frames, options, finished, finish: resolve, cancelled: false,
      cancel() { this.cancelled = true; reject(new Error('cancelled')); } };
    motions.push(motion); return motion;
  };
  const source = fs.readFileSync(path.join(root, 'vk-auth.js'), 'utf8');
  const context = { vkEl: keyboard, active: false,
    document: { body: { classList: { contains: name => name === 'signin' } } },
    window: { matchMedia: () => ({ matches: reduced }) },
    getComputedStyle: () => ({ transform: 'matrix(1, 0, 0, 1, 0, 12)', opacity: '0.5' }),
  };
  vm.runInNewContext(source.slice(source.indexOf('  let keyboardMotion'), source.indexOf('  /** Ordered focus chain')), context);
  return { keyboard, motions, context, move: (visible, wasVisible = true) => context.moveSigninKeyboard(visible, wasVisible) };
}

test('reopening halfway through keyboard exit cancels the old hide completion', async () => {
  const k = keyboardMotion(); k.move(false);
  k.context.active = true; k.move(true);
  assert.equal(k.motions[0].cancelled, true);
  assert.equal(k.motions[1].frames[0].opacity, '0.5');
  assert.equal(k.motions[1].options.duration, 320);
  k.motions[1].finish(); await new Promise(setImmediate);
  assert.equal(k.keyboard.style.display, 'block');
});

test('keyboard is hidden only after its exit finishes', async () => {
  const k = keyboardMotion(); k.move(false);
  assert.equal(k.keyboard.style.display, 'block');
  k.motions[0].finish(); await new Promise(setImmediate);
  assert.equal(k.keyboard.style.display, 'none');
});

test('reduced-motion keyboard changes do not animate', () => {
  const k = keyboardMotion(true); k.move(false);
  assert.equal(k.keyboard.style.display, 'none');
  k.move(true, false); assert.equal(k.keyboard.style.display, 'block');
  assert.equal(k.motions.length, 0);
});

test('card movement never animates layout height and its surface shares the same timing', () => {
  const context = { setTimeout() {}, clearTimeout() {} };
  const source = fs.readFileSync(path.join(root, 'signin-ui.js'), 'utf8').split('(function () {')[0];
  vm.runInNewContext(source, context);
  const capture = { animate: (frames, timing) => ({ frames, timing }) };
  const result = context.animateSigninCard(capture, capture,
    { height: 400, bottom: 600 }, { height: 250, bottom: 340 });
  assert.equal(result.move.frames[0].transform, 'translateY(260px)');
  assert.equal(result.paint.frames[0].transform, 'scaleY(1.6)');
  assert.equal(result.move.frames.some(frame => 'height' in frame), false);
  assert.equal(result.paint.frames.some(frame => 'height' in frame), false);
  assert.equal(result.move.timing, result.paint.timing);
});

test('welcome text waits for keyboard and card to settle, including a reversed close', () => {
  const context = { setTimeout() {}, clearTimeout() {} };
  const source = fs.readFileSync(path.join(root, 'signin-ui.js'), 'utf8').split('(function () {')[0];
  vm.runInNewContext(source, context);
  let moving = false, keyboard = false, hidden = false;
  const title = { classList: { toggle(name, value) { hidden = value; } }, setAttribute() {} };
  const welcome = context.createSigninWelcomeVisibility(title, () => moving, () => keyboard);
  welcome.refresh(); assert.equal(hidden, false);
  welcome.setActive(true); keyboard = true;
  welcome.setActive(false); assert.equal(hidden, true);
  keyboard = false; moving = true;
  welcome.refresh(); assert.equal(hidden, true);
  // Reopening must not let the previous close reveal the heading.
  welcome.setActive(true); moving = false;
  welcome.refresh(); assert.equal(hidden, true);
  welcome.setActive(false); assert.equal(hidden, false);
});
