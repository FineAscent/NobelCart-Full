/* Shared, bounded product-photo loading. Original image URLs and quality are preserved. */
(function (root) {
  'use strict';
  const BUFFER = 15000;
  const CACHE_AGE = 30 * 60 * 1000;
  const MAX_ENTRIES = 120;

  function expiry(url) {
    try {
      const parsed = new URL(url);
      const stamp = parsed.searchParams.get('X-Amz-Date');
      const seconds = Number(parsed.searchParams.get('X-Amz-Expires'));
      if (stamp && seconds > 0) {
        const start = Date.parse(stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
        if (Number.isFinite(start)) return start + seconds * 1000;
      }
      const token = parsed.searchParams.get('token');
      if (token) {
        const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
        if (Number.isFinite(payload.exp)) return payload.exp * 1000;
      }
    } catch (_) { }
    return null;
  }

  function queue(limit) {
    let active = 0;
    const waiting = [];
    function drain() {
      while (active < limit && waiting.length) {
        const { work, resolve, reject } = waiting.shift();
        active++;
        Promise.resolve().then(work).then(resolve, reject).finally(() => { active--; drain(); });
      }
    }
    return work => new Promise((resolve, reject) => { waiting.push({ work, resolve, reject }); drain(); });
  }

  function loadPhoto(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      const timer = setTimeout(() => {
        image.onload = image.onerror = null;
        image.removeAttribute('src');
        reject(new Error('Image request timed out'));
      }, 30000);
      image.onload = () => {
        clearTimeout(timer);
        image.onload = image.onerror = null;
        // onload proves the file is usable even if decode() fails on a low-memory panel.
        if (image.naturalWidth > 0) resolve(image);
        else reject(new Error('Image has no pixels'));
      };
      image.onerror = () => {
        clearTimeout(timer);
        image.onload = image.onerror = null;
        reject(new Error('Image could not load'));
      };
      image.src = url;
    });
  }

  function create({ sign, storage, scope = '', now = Date.now, load = loadPhoto, concurrency = 3 }) {
    const cache = new Map(), pendingUrls = new Map(), pendingPhotos = new Map();
    const failures = new Map(), signingFailures = new Map();
    const signQueue = queue(concurrency), photoQueue = queue(concurrency);
    const storageKey = 'nc_product_image_urls_v2:' + scope;
    let saveTimer;
    const fresh = url => { const end = expiry(url); return !end || end > now() + BUFFER; };
    const trim = map => { while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value); };
    function flush() {
      clearTimeout(saveTimer);
      try { storage?.setItem(storageKey, JSON.stringify([...cache].filter(([, value]) => value.until > now()))); } catch (_) { }
    }
    function remember(key, url) {
      if (!key || !url) return url;
      cache.delete(key);
      cache.set(key, { url, until: Math.min(now() + CACHE_AGE, (expiry(url) || Infinity) - BUFFER) });
      trim(cache);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 150);
      return url;
    }
    try {
      const rows = JSON.parse(storage?.getItem(storageKey) || '[]');
      for (const [key, value] of rows.slice(-MAX_ENTRIES)) {
        if (typeof key === 'string' && typeof value?.url === 'string' && value.until > now() && fresh(value.url)) cache.set(key, value);
      }
    } catch (_) { }

    async function resolve(key, { force = false } = {}) {
      key = String(key || '');
      if (!key) throw new Error('Missing image key');
      if (pendingUrls.has(key)) return pendingUrls.get(key);
      const blocked = signingFailures.get(key);
      if (blocked && blocked.retryAt > now()) throw blocked;
      const hit = cache.get(key);
      if (!force && hit?.until > now() && fresh(hit.url)) return hit.url;
      const pending = signQueue(async () => {
        try {
          const url = await sign(key);
          if (!url) throw new Error('No image URL returned');
          signingFailures.delete(key);
          return remember(key, url);
        } catch (error) {
          error.retryAt = now() + 5000;
          signingFailures.set(key, error);
          trim(signingFailures);
          throw error;
        }
      });
      pendingUrls.set(key, pending);
      try { return await pending; } finally { pendingUrls.delete(key); }
    }

    async function photo(descriptor, { isCurrent = () => true } = {}) {
      const key = descriptor.key ? String(descriptor.key) : null;
      const identity = key || descriptor.url;
      const blocked = failures.get(identity);
      if (blocked?.retryAt > now()) throw blocked;
      const existing = pendingPhotos.get(identity);
      if (existing) { existing.checks.push(isCurrent); return existing.promise; }
      const task = { checks: [isCurrent] };
      task.promise = photoQueue(async () => {
        if (!task.checks.some(check => check())) {
          const error = new Error('Image view changed'); error.cancelled = true; throw error;
        }
        let url;
        let refreshed = blocked?.refreshed || false;
        try {
          const initial = descriptor.url;
          const hit = key && cache.get(key);
          if (hit?.until > now() && fresh(hit.url)) url = hit.url;
          else if (initial && fresh(initial)) { url = initial; if (key) remember(key, initial); }
          else url = key ? await resolve(key) : initial;
          if (!url) throw new Error('No product image');
          let image;
          try { image = await load(url); }
          catch (error) {
            // Refresh once per failed image, not continuously for a missing file.
            if (!key || refreshed) throw error;
            url = await resolve(key, { force: true });
            refreshed = true;
            image = await load(url);
          }
          failures.delete(identity);
          return { url, key, image };
        } catch (error) {
          if (!error.cancelled) {
            error.attempts = (blocked?.attempts || 0) + 1;
            error.refreshed = refreshed;
            error.retryAt = Math.max(error.retryAt || 0, now() + Math.min(120000, 5000 * 2 ** (error.attempts - 1)));
            failures.set(identity, error);
            trim(failures);
          }
          throw error;
        }
      });
      pendingPhotos.set(identity, task);
      try { return await task.promise; } finally { pendingPhotos.delete(identity); }
    }

    function retry(identity) {
      failures.delete(identity);
      signingFailures.delete(identity);
    }
    return { resolve, photo, remember, fresh, flush, retry };
  }
  const api = { create, expiry };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NobelProductImages = api;
})(typeof window !== 'undefined' ? window : globalThis);
