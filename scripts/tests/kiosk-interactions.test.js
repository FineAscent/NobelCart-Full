const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../site.js'), 'utf8');

function gestures() {
  let now = 1000;
  const handlers = {}, documentHandlers = {};
  const first = [], doubles = [];
  const root = {
    addEventListener(type, fn, options) { handlers[type] = fn; if (type !== 'click') assert.equal(options.passive, true); },
    contains: () => true
  };
  const context = {
    Date: { now: () => now },
    document: { addEventListener(type, fn) { documentHandlers[type] = fn; } }
  };
  vm.runInNewContext(source.slice(source.indexOf('function bindKioskDoubleTap('), source.indexOf('// Hoisted function declaration')), context);
  context.bindKioskDoubleTap(root, '.product-card', c => first.push(c), c => doubles.push(c));
  return {
    first, doubles, handlers,
    advance: ms => { now += ms; },
    scroll: () => documentHandlers.scroll(),
    tap(card) {
      handlers.pointerdown({ clientX: 0, clientY: 0 });
      handlers.click({ target: { closest: () => card } });
    }
  };
}

test('touch clicks show a hint and add once without requiring native dblclick', () => {
  const g = gestures(), card = {};
  g.tap(card);
  assert.equal(g.first.length, 1);
  g.advance(900);
  g.tap(card);
  assert.deepEqual(g.doubles, [card]);
  assert.equal(g.handlers.dblclick, undefined);
});

test('different cards, expired taps, and scrolling do not add items', () => {
  const g = gestures(), a = {}, b = {};
  g.tap(a); g.tap(b);
  g.advance(1501); g.tap(b);
  g.scroll(); g.tap(b);
  assert.equal(g.doubles.length, 0);
  g.handlers.pointermove({ clientX: 0, clientY: 40 });
  g.handlers.click({ target: { closest: () => b } });
  assert.equal(g.doubles.length, 0);
});

function presence(storedActivity) {
  let now = 1_000_000, nextId = 0, shown = 0, prompt;
  const timers = new Map(), storage = new Map(), listeners = {};
  if (storedActivity != null) storage.set('nc_last_activity_at', String(now - storedActivity));
  const context = {
    Date: { now: () => now }, URLSearchParams,
    location: { pathname: '/category.html' },
    window: { location: { search: '' } },
    document: { body: { classList: { contains: () => false } }, getElementById: () => null },
    sessionStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v) },
    setTimeout(fn, ms) { const id = ++nextId; timers.set(id, { fn, due: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
    trackKioskActivity(fn) { listeners.activity = fn; },
    showPresenceModal(opts) { shown++; prompt = opts; return { close() {} }; }
  };
  const start = source.indexOf('  // Inactivity monitor (non-admin pages only)');
  const end = source.indexOf('  // Add click functionality to checkout button', start);
  vm.runInNewContext(source.slice(start, end), context);
  return {
    get shown() { return shown; },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.fn(); }
    },
    activity: () => listeners.activity(),
    confirm: () => prompt.onConfirm()
  };
}

test('presence prompt waits seven inactive minutes, then repeats seven minutes after confirmation', () => {
  const p = presence();
  p.advance(419999); assert.equal(p.shown, 0);
  p.advance(1); assert.equal(p.shown, 1);
  p.confirm();
  p.advance(419999); assert.equal(p.shown, 1);
  p.advance(1); assert.equal(p.shown, 2);
});

test('automatic page navigation preserves elapsed inactivity and activity resets it', () => {
  const p = presence(40000);
  p.advance(379999); assert.equal(p.shown, 0);
  p.advance(1); assert.equal(p.shown, 1);
  const active = presence(40000);
  active.advance(300000); active.activity();
  active.advance(419999); assert.equal(active.shown, 0);
  active.advance(1); assert.equal(active.shown, 1);
});

test('keyboard viewport follows its measured height and clears when dismissed', () => {
  const classes = new Set(), properties = new Map(), events = [];
  const context = {
    window: {},
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    document: {
      body: {
        style: { setProperty: (key, value) => properties.set(key, value) },
        classList: { toggle(key, enabled) { if (enabled) classes.add(key); else classes.delete(key); } }
      },
      dispatchEvent: event => events.push(event)
    }
  };
  const start = source.indexOf('window.ncSetKeyboardViewport =');
  vm.runInNewContext(source.slice(start, source.indexOf('// Capture also sees', start)), context);
  const keyboard = { offsetHeight: 261 };
  context.window.ncSetKeyboardViewport(keyboard, true);
  assert.equal(properties.get('--nc-keyboard-height'), '261px');
  assert.equal(classes.has('keyboard-open'), true);
  assert.equal(events[0].bubbles, true, 'signup listens for visibility on window');
  keyboard.offsetHeight = 300;
  context.window.ncSetKeyboardViewport(keyboard, true);
  assert.equal(properties.get('--nc-keyboard-height'), '300px');
  context.window.ncSetKeyboardViewport(keyboard, false);
  assert.equal(properties.get('--nc-keyboard-height'), '0px');
  assert.equal(classes.has('keyboard-open'), false);
  assert.equal(events.at(-1).detail.visible, false);
});

test('scale preview toggles by clicking the video, and Escape restores keyboard focus', () => {
  const classes = new Set(), attrs = new Map(), handlers = {};
  let focused = false;
  const toggle = {
    setAttribute: (key, value) => attrs.set(key, value),
    addEventListener: (type, fn) => { handlers[type] = fn; },
    focus: () => { focused = true; }
  };
  const modal = {
    querySelector: selector => selector === '.wm-guide-frame' ? toggle : null,
    classList: { toggle(key, enabled) { if (enabled) classes.add(key); else classes.delete(key); } },
    addEventListener: (type, fn) => { handlers[type] = fn; }
  };
  const context = {};
  const start = source.indexOf('function bindWeightPreview(');
  vm.runInNewContext(source.slice(start, source.indexOf('async function showWeightModal(', start)), context);
  context.bindWeightPreview(modal);
  handlers.click();
  assert.equal(classes.has('weight-modal--preview-expanded'), true);
  assert.equal(attrs.get('aria-expanded'), 'true');
  assert.equal(attrs.get('aria-label'), 'Shrink scale preview');
  handlers.click();
  assert.equal(classes.has('weight-modal--preview-expanded'), false);
  assert.equal(attrs.get('aria-expanded'), 'false');
  assert.equal(attrs.get('aria-label'), 'Enlarge scale preview');
  handlers.click();
  let prevented = false;
  handlers.keydown({ key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(classes.has('weight-modal--preview-expanded'), false);
  assert.equal(prevented, true);
  assert.equal(focused, true);
});
