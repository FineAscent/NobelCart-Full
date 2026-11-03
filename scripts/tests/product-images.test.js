const test = require('node:test');
const assert = require('node:assert/strict');
const { create, expiry } = require('../../product-images.js');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const settle = () => new Promise(resolve => setImmediate(resolve));
const start = Date.UTC(2026, 10, 2, 12);
function signed(key, time = start, revision = 1) {
  const stamp = new Date(time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `https://catalog.s3.us-east-1.amazonaws.com/${key}?X-Amz-Date=${stamp}&X-Amz-Expires=3600&v=${revision}`;
}
function memory() {
  const entries = new Map();
  return { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
}

test('duplicate products share signing and image work; photos retain the exact original URL', async () => {
  let signs = 0, loads = 0;
  const loader = create({ now: () => start, sign: async key => { signs++; return signed(key); }, load: async () => { loads++; } });
  const [a, b] = await Promise.all([loader.photo({ key: 'apples.webp' }), loader.photo({ key: 'apples.webp' })]);
  assert.equal(a.url, signed('apples.webp'));
  assert.equal(a.url, b.url);
  await loader.photo({ key: 'apples.webp' });
  assert.equal(signs, 1);
  assert.equal(loads, 2, 'new views validate the image; the browser handles cached bytes');
  loader.flush();
});

test('valid signed URLs survive page navigation and expired links are renewed', async () => {
  const storage = memory(); let now = start, signs = 0;
  const options = { storage, scope: 'catalog-api', now: () => now, sign: async key => { signs++; return signed(key, now, signs); } };
  const first = create(options);
  const url = await first.resolve('carrots.webp'); first.flush();
  const nextPage = create(options);
  assert.equal(await nextPage.resolve('carrots.webp'), url);
  assert.equal(signs, 1);
  now += 3600000;
  assert.notEqual(await nextPage.resolve('carrots.webp'), url);
  assert.equal(signs, 2);
  nextPage.flush();
});

test('both S3 and Supabase link expirations are recognized', () => {
  assert.equal(expiry(signed('photo')), start + 3600000);
  const token = 'header.' + Buffer.from(JSON.stringify({ exp: start / 1000 + 120 })).toString('base64url') + '.signature';
  assert.equal(expiry('https://example.supabase.co/storage/photo?token=' + token), start + 120000);
  assert.equal(expiry('https://example.test/photo.webp'), null);
  assert.equal(expiry('invalid URL'), null);
});

test('no more than three image jobs run at once, even for a large catalog', async () => {
  let active = 0, peak = 0;
  const releases = [];
  const loader = create({ now: () => start, sign: async key => signed(key), load: async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => releases.push(resolve)); active--;
  } });
  const jobs = Array.from({ length: 15 }, (_, i) => loader.photo({ key: String(i) }));
  await settle();
  assert.equal(active, 3);
  for (let i = 0; i < 5; i++) {
    releases.splice(0).forEach(release => release());
    await settle();
  }
  await Promise.all(jobs);
  assert.equal(peak, 3);
  loader.flush();
});

test('an early-expired cached URL is refreshed once and a stale descriptor cannot overwrite its replacement', async () => {
  const bad = signed('pear', start, 1), good = signed('pear', start, 2);
  let signs = 0; const requests = [];
  const loader = create({ now: () => start, sign: async () => { signs++; return good; }, load: async url => {
    requests.push(url); if (url === bad) throw new Error('Expired AWS session');
  } });
  loader.remember('pear', bad);
  assert.equal((await loader.photo({ key: 'pear', url: bad })).url, good);
  assert.equal((await loader.photo({ key: 'pear', url: bad })).url, good);
  assert.deepEqual(requests, [bad, good, good]);
  assert.equal(signs, 1);
  loader.flush();
});

test('missing files back off and do not repeatedly call the signing API', async () => {
  let now = start, signs = 0, loads = 0;
  const loader = create({ now: () => now, sign: async key => { signs++; return signed(key); }, load: async () => { loads++; throw new Error('Missing object'); } });
  await assert.rejects(loader.photo({ key: 'missing' }));
  assert.equal(signs, 2, 'initial URL plus one recovery signature');
  const previousLoads = loads;
  await assert.rejects(loader.photo({ key: 'missing' }));
  assert.equal(loads, previousLoads, 'cooldown must prevent a request storm');
  now += 5001;
  await assert.rejects(loader.photo({ key: 'missing' }));
  assert.equal(signs, 2, 'a still-missing file must not be resigned every retry');
  loader.flush();
});

test('signing failures are deduplicated and briefly cached', async () => {
  let signs = 0;
  const loader = create({ now: () => start, sign: async () => { signs++; throw new Error('API offline'); } });
  await Promise.allSettled([loader.resolve('same'), loader.resolve('same')]);
  await assert.rejects(loader.resolve('same'));
  assert.equal(signs, 1);
  loader.flush();
});

test('obsolete queued views do no work, while a current view can join the same queued photo', async () => {
  let unblock;
  const signedKeys = [];
  const loader = create({ concurrency: 1, now: () => start, sign: async key => { signedKeys.push(key); return signed(key); }, load: async url => {
    if (url.includes('/first?')) await new Promise(resolve => { unblock = resolve; });
  } });
  const first = loader.photo({ key: 'first' });
  await settle();
  const skipped = loader.photo({ key: 'old' }, { isCurrent: () => false });
  const skippedCheck = assert.rejects(skipped, error => error.cancelled === true);
  const old = loader.photo({ key: 'shared' }, { isCurrent: () => false });
  const current = loader.photo({ key: 'shared' }, { isCurrent: () => true });
  unblock();
  await Promise.all([first, skippedCheck, old, current]);
  assert.deepEqual(signedKeys, ['first', 'shared']);
  loader.flush();
});

test('a usable image is accepted even when the browser cannot provide decode()', async () => {
  let decodeCalls = 0;
  const context = {
    module: { exports: {} }, URL, atob, setTimeout, clearTimeout,
    Image: class {
      naturalWidth = 1600;
      decode() { decodeCalls++; return Promise.reject(new Error('decode memory pressure')); }
      set src(_url) { queueMicrotask(() => this.onload()); }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../product-images.js'), 'utf8'), context);
  const loader = context.module.exports.create({ now: () => start, sign: async key => signed(key) });
  assert.equal((await loader.photo({ key: 'photo' })).url, signed('photo'));
  assert.equal(decodeCalls, 0);
  loader.flush();
});

const site = fs.readFileSync(path.join(__dirname, '../../site.js'), 'utf8');
test('image keys identify the correct S3 object and Supabase bucket', () => {
  const context = { URL };
  const start = site.indexOf('function imageKeyFromUrl(');
  vm.runInNewContext(site.slice(start, site.indexOf('function isSignedUrlFresh(', start)), context);
  assert.equal(context.imageKeyFromUrl('https://catalog.s3.us-east-1.amazonaws.com/photos/apple.webp'), 'photos/apple.webp');
  assert.equal(context.imageKeyFromUrl('https://s3.us-east-1.amazonaws.com/catalog/photos/apple.webp'), 'photos/apple.webp');
  assert.equal(context.imageKeyFromUrl('https://example.supabase.co/storage/v1/object/sign/cabinet-uploads/u/photo.webp?token=x'), 'cabinet-uploads/u/photo.webp');
  assert.equal(context.imageKeyFromUrl('https://unrelated.test/photo.webp'), null);
});

test('photo metadata updates match product IDs rather than another item with the same name', () => {
  const items = [{ id: '1', name: 'Apple', image: 'first', qty: 2 }, { id: '2', name: 'Apple', image: 'second', qty: 4 }];
  const context = { loadCart: () => items, saveCart: () => {} };
  const start = site.indexOf('function rememberCartProductImage(');
  vm.runInNewContext(site.slice(start, site.indexOf('const __cardImages', start)), context);
  context.rememberCartProductImage('2', 'Apple', { url: 'correct', key: 'key-2' });
  assert.equal(items[0].image, 'first');
  assert.equal(items[1].image, 'correct');
  assert.equal(items[1].qty, 4);
});

test('two views sharing a preloaded photo get separate elements rather than moving one image between cards', async () => {
  const url = signed('shared');
  const original = { complete: true, naturalWidth: 1600, getAttribute: () => url };
  let clones = 0;
  const context = {
    WeakSet, setTimeout, clearTimeout,
    Image: class {
      constructor() { clones++; }
      getAttribute() { return this.url; }
      set src(value) { this.url = value; queueMicrotask(() => this.onload()); }
    }
  };
  const start = site.indexOf('const __claimedProductPhotos');
  vm.runInNewContext(site.slice(start, site.indexOf('function showCardImageError(', start)), context);
  const asset = { url, image: original };
  const [first, second] = await Promise.all([context.productPhotoElement(asset), context.productPhotoElement(asset)]);
  assert.equal(first, original);
  assert.notEqual(second, first);
  assert.equal(clones, 1);
});

test('a completed request from an obsolete view cannot paint its old photo into the current view', async () => {
  let finish;
  const image = { querySelector: () => null, classList: { add() {}, remove() {} }, setAttribute() {}, textContent: '', replaceChildren() { throw new Error('Stale image painted'); } };
  const card = { isConnected: true, querySelector: () => image, setAttribute() { throw new Error('Stale data assigned'); } };
  const state = { descriptor: { key: 'old' }, attempts: 0, near: true };
  const states = new WeakMap([[card, state]]);
  const context = {
    __cardImages: states,
    __productImages: { photo: () => new Promise(resolve => { finish = resolve; }) },
    clearTimeout() {},
    productPhotoElement() { throw new Error('Obsolete photo should not create another element'); }
  };
  const start = site.indexOf('async function loadCardImage(');
  vm.runInNewContext(site.slice(start, site.indexOf('function observeCardImage(', start)), context);
  const request = context.loadCardImage(card, state);
  states.set(card, { descriptor: { key: 'new' } });
  finish({ url: signed('old') });
  await request;
  assert.equal(state.pending, false);
  assert.notEqual(state.status, 'loaded');
});

test('a temporary signing outage does not permanently consume image recovery', async () => {
  let now = start, signs = 0;
  const old = signed('retry', start, 1), replacement = signed('retry', start, 2);
  const loader = create({
    now: () => now,
    sign: async () => { if (++signs === 1) throw new Error('Temporary API outage'); return replacement; },
    load: async url => { if (url === old) throw new Error('Early expired URL'); }
  });
  loader.remember('retry', old);
  await assert.rejects(loader.photo({ key: 'retry' }));
  now += 5001;
  assert.equal((await loader.photo({ key: 'retry' })).url, replacement);
  assert.equal(signs, 2);
  loader.flush();
});
