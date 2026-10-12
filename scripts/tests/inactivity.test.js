const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../site.js'), 'utf8');
const helper = source.slice(source.indexOf('function trackKioskActivity('), source.indexOf('// ---- Supabase Receipt & Checkout History ----'));
const idle = source.slice(source.indexOf('// --- Inactivity Timer for Grid/Category Views ---'));

test('scroll, typing, pointer movement, and virtual keyboard activity renew category inactivity', () => {
  let now = 0, nextId = 0;
  const timers = new Map(), listeners = new Map();
  const context = {
    document: {
      body: { classList: { contains: name => name === 'category-page' } },
      getElementById: () => null,
      addEventListener(type, fn, options) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push({ fn, options });
      }
    },
    window: { location: { href: '' } },
    setTimeout(fn, ms) { const id = ++nextId; timers.set(id, { fn, due: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const advance = ms => {
    now += ms;
    for (const [id, timer] of timers) if (timer.due <= now) { timers.delete(id); timer.fn(); }
  };
  vm.runInNewContext(helper + idle, context);
  listeners.get('DOMContentLoaded')[0].fn();
  for (const type of ['scroll', 'wheel', 'input', 'pointermove', 'touchmove', 'click', 'change', 'keydown']) {
    advance(29000);
    assert.equal(context.window.location.href, '', `did not wait for ${type}`);
    const listener = listeners.get(type)[0];
    assert.equal(listener.options.capture, true, `${type} must catch nested non-bubbling activity`);
    assert.equal(listener.options.passive, true, `${type} must not block scrolling`);
    listener.fn();
    assert.equal(timers.size, 1);
  }
  advance(29999);
  assert.equal(context.window.location.href, '');
  advance(1);
  assert.equal(context.window.location.href, 'index.html');
});
