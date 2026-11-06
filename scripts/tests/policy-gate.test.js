const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup({ accepted = false, save } = {}) {
  let overlay, saveCount = 0, loaderVisible = true;
  const events = [];
  const element = () => ({ hidden: false, disabled: false, checked: false,
    handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } });
  const window = {
    hideLoadingOverlay() { loaderVisible = false; },
    dispatchEvent(event) { events.push(event.type); },
  };
  const document = {
    activeElement: { blur() {} }, addEventListener() {}, removeEventListener() {},
    body: { appendChild(node) { overlay = node; } },
    createElement() {
      const children = Object.fromEntries(['.policy-agree-box', '.policy-confirm', '.policy-cancel', '.policy-scroll', '.policy-error'].map(name => [name, element()]));
      children['.policy-error'].hidden = true;
      return { children, querySelector: name => children[name], remove() { overlay = null; } };
    },
  };
  const sb = { from() { return {
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: {
      policy_accepted: accepted, policy_version: window.ncPolicy.VERSION,
    } }) }) }),
    update: record => ({ eq: () => ({ select: async () => {
      saveCount++;
      assert.equal(record.policy_accepted, true);
      return save ? save(saveCount) : { data: [{ id: 'user-1' }], error: null };
    } }) }),
    insert: async () => ({ error: null }),
  }; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../policy-gate.js'), 'utf8'), {
    window, document, Event: class { constructor(type) { this.type = type; } }, Date,
  });
  return { window, sb, events, get overlay() { return overlay; },
    get loaderVisible() { return loaderVisible; }, get saveCount() { return saveCount; },
    async open() { this.result = window.ncPolicy.requireAccepted(sb, 'user-1'); await Promise.resolve(); await Promise.resolve(); },
    async agree() {
      const box = overlay.children['.policy-agree-box'];
      box.checked = true; box.handlers.change();
      await overlay.children['.policy-confirm'].handlers.click();
    },
  };
}

test('first agreement removes the blocking sign-in loader and waits for a successful save', async () => {
  let finishSave;
  const p = setup({ save: () => new Promise(resolve => { finishSave = resolve; }) });
  await p.open();
  assert.equal(p.loaderVisible, false);
  assert.match(p.overlay.className, /policy-overlay/);
  assert.deepEqual(p.events, ['nc:policy-open']);
  // Clicking without a choice never saves acceptance.
  await p.overlay.children['.policy-confirm'].handlers.click();
  assert.equal(p.saveCount, 0);
  const agreement = p.agree();
  assert.equal(p.overlay.children['.policy-cancel'].disabled, true);
  assert.equal(p.overlay.children['.policy-agree-box'].disabled, true);
  assert.equal(p.saveCount, 1);
  finishSave({ data: [{ id: 'user-1' }], error: null });
  await agreement;
  assert.equal(await p.result, true);
  assert.equal(p.overlay, null);
});

test('failed agreement saves remain visible and can be retried without signing in again', async () => {
  const p = setup({ save: attempt => attempt === 1
    ? { data: null, error: new Error('Temporary write failure') }
    : { data: [{ id: 'user-1' }], error: null } });
  await p.open(); await p.agree();
  assert.ok(p.overlay);
  assert.equal(p.overlay.children['.policy-error'].hidden, false);
  assert.equal(p.overlay.children['.policy-confirm'].disabled, false);
  assert.equal(p.overlay.children['.policy-cancel'].disabled, false);
  await p.agree();
  assert.equal(await p.result, true);
  assert.equal(p.saveCount, 2);
});

test('cancel closes the gate without saving agreement or allowing sign-in', async () => {
  const p = setup(); await p.open();
  p.overlay.children['.policy-cancel'].handlers.click();
  assert.equal(await p.result, false);
  assert.equal(p.saveCount, 0);
  assert.equal(p.overlay, null);
});

test('an already accepted current policy does not interrupt sign-in', async () => {
  const p = setup({ accepted: true }); await p.open();
  assert.equal(await p.result, true);
  assert.equal(p.overlay, undefined);
  assert.equal(p.loaderVisible, true);
  assert.equal(p.saveCount, 0);
});
