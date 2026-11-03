const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../drag-scroll.js'), 'utf8');

function setup({ reduced = false, top = 300, control = false, button = false, scrollable = true, paneSelector = '.left-section' } = {}) {
  const listeners = new Map(), frames = new Map(), classes = new Set();
  let now = 0, id = 0, captures = 0, cancels = 0;
  const pane = {
    scrollTop: top, clientHeight: 200, scrollHeight: scrollable ? 1200 : 200,
    classList: { add: x => classes.add(x), remove: x => classes.delete(x) },
    setPointerCapture() { captures++; }, releasePointerCapture() {}, parentElement: null
  };
  const target = { closest(selector) {
    if (selector.split(',').map(x => x.trim()).includes(paneSelector)) return pane;
    if (selector.includes('input')) return control ? {} : null;
    return button ? {} : null;
  } };
  const context = {
    document: {
      readyState: 'complete',
      body: { classList: { add: x => classes.add(x) } },
      addEventListener(type, fn, options) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push({ fn, options });
      },
      dispatchEvent(event) { for (const { fn } of listeners.get(event.type) || []) fn(event); }
    },
    window: { PointerEvent: function () {}, matchMedia: () => ({ matches: reduced }), addEventListener() {} },
    performance: { now: () => now },
    CustomEvent: class { constructor(type) { this.type = type; } },
    requestAnimationFrame(fn) { frames.set(++id, fn); return id; },
    cancelAnimationFrame(key) { frames.delete(key); }
  };
  vm.runInNewContext(source, context);
  function emit(type, overrides = {}) {
    const event = {
      type, pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0,
      clientX: 80, clientY: 200, timeStamp: now, target,
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...overrides
    };
    for (const { fn } of listeners.get(type) || []) fn(event);
    return event;
  }
  listeners.set('nc:drag-scroll', [{ fn: () => { cancels++; } }]);
  return {
    pane, frames, classes, emit,
    captures: () => captures, tapCancels: () => cancels,
    tick(ms) { now += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now)); }
  };
}

for (const pointerType of ['touch', 'mouse', 'pen']) {
  test(`${pointerType}: vertical drag scrolls once per frame and suppresses the following click`, () => {
    const s = setup();
    s.emit('pointerdown', { pointerType });
    s.emit('pointermove', { pointerType, clientY: 160, timeStamp: 40 });
    s.emit('pointermove', { pointerType, clientY: 100, timeStamp: 80 });
    assert.equal(s.frames.size, 1, 'movement must be coalesced at display refresh rate');
    assert.equal(s.pane.scrollTop, 300);
    s.tick(33.3);
    assert.equal(s.pane.scrollTop, 400);
    assert.equal(s.captures(), 1);
    assert.equal(s.tapCancels(), 1, 'cancel a pending product double-tap as dragging starts');
    s.emit('pointerup', { pointerType, clientY: 100, timeStamp: 81 });
    const click = s.emit('click');
    assert.equal(click.prevented, true);
    assert.equal(click.stopped, true);
    s.emit('pointerdown', { pointerType });
    s.emit('pointerup', { pointerType });
    assert.equal(s.emit('click').prevented, undefined, 'the next real tap must work');
  });
}

test('small finger movement and input controls keep ordinary tap behavior', () => {
  for (const config of [{}, { control: true }]) {
    const s = setup(config);
    s.emit('pointerdown');
    s.emit('pointermove', { clientY: 197, timeStamp: 20 });
    s.emit('pointerup');
    assert.equal(s.frames.size, 0);
    assert.equal(s.pane.scrollTop, 300);
    assert.equal(s.emit('click').prevented, undefined);
  }
});

test('horizontal swipes never scroll, change into vertical drags, or activate an item', () => {
  for (const paneSelector of ['.left-section', '.right-section .cart-items']) {
    const s = setup({ paneSelector });
    s.emit('pointerdown');
    s.emit('pointermove', { clientX: 150, clientY: 195, timeStamp: 40 });
    s.emit('pointermove', { clientX: 150, clientY: 80, timeStamp: 100 });
    s.emit('pointerup');
    assert.equal(s.frames.size, 0);
    assert.equal(s.pane.scrollTop, 300);
    assert.equal(s.captures(), 0);
    assert.equal(s.emit('click').prevented, true);
    s.emit('pointerdown');
    s.emit('pointerup');
    assert.equal(s.emit('click').prevented, undefined);
  }
});

test('touch dragging over a cart button scrolls instead of activating that button', () => {
  const s = setup({ button: true });
  s.emit('pointerdown');
  s.emit('pointermove', { clientY: 100, timeStamp: 100 });
  s.emit('pointerup', { timeStamp: 101 });
  assert.equal(s.pane.scrollTop, 400);
  assert.equal(s.emit('click').prevented, true);
});

test('scroll bounds, pointer cancellation, reduced motion, and a second finger stop momentum', () => {
  for (const top of [0, 1000]) {
    const s = setup({ top });
    s.emit('pointerdown');
    s.emit('pointermove', { clientY: top === 0 ? 300 : 100, timeStamp: 100 });
    s.emit('pointercancel', { timeStamp: 101 });
    assert.equal(s.pane.scrollTop, top);
    assert.equal(s.frames.size, 0);
    assert.equal(s.classes.has('is-drag-scrolling'), false);
  }
  const s = setup({ reduced: true });
  s.emit('pointerdown');
  s.emit('pointermove', { clientY: 100, timeStamp: 100 });
  s.emit('pointerup', { timeStamp: 101 });
  assert.equal(s.pane.scrollTop, 400);
  assert.equal(s.frames.size, 0);
  const pinch = setup();
  pinch.emit('pointerdown');
  pinch.emit('pointermove', { clientY: 100, timeStamp: 100 });
  pinch.emit('pointerdown', { pointerId: 2, isPrimary: false });
  assert.equal(pinch.frames.size, 0);
  assert.equal(pinch.classes.has('is-drag-scrolling'), false);
});

test('momentum travels the same distance at 30 Hz and 60 Hz', () => {
  function distance(hz) {
    const s = setup();
    s.emit('pointerdown');
    s.emit('pointermove', { clientY: 100, timeStamp: 100 });
    s.emit('pointerup', { timeStamp: 101 });
    for (let i = 0; i < hz; i++) s.tick(1000 / hz);
    assert.equal(s.frames.size, 0);
    return s.pane.scrollTop;
  }
  assert.ok(Math.abs(distance(30) - distance(60)) < 1);
});

test('panes without overflow do not intercept touch gestures', () => {
  const s = setup({ scrollable: false, top: 0 });
  s.emit('pointerdown');
  const move = s.emit('pointermove', { clientY: 100, timeStamp: 100 });
  assert.equal(move.prevented, undefined);
  assert.equal(s.frames.size, 0);
});


test('Total list supports touch scrolling in both directions and keeps remove taps separate from drags', () => {
  const s = setup({ paneSelector: '.right-section .cart-items', top: 0, button: true, reduced: true });
  s.emit('pointerdown');
  s.emit('pointermove', { clientY: 80, timeStamp: 100 });
  s.tick(33);
  assert.equal(s.pane.scrollTop, 120);
  s.emit('pointerup', { timeStamp: 101 });
  assert.equal(s.emit('click').prevented, true, 'dragging over X must not remove an item');
  s.emit('pointerdown');
  s.emit('pointermove', { clientY: 260, timeStamp: 200 });
  s.tick(33);
  s.emit('pointerup', { timeStamp: 201 });
  assert.equal(s.pane.scrollTop, 60);
  s.emit('click');
  s.emit('pointerdown');
  s.emit('pointerup');
  assert.equal(s.emit('click').prevented, undefined, 'a deliberate X tap still works');
});
