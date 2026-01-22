// --- API helpers ---
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || '';
async function apiFetch(path, options = {}) {
  const url = API_BASE + path;
  const opts = {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${opts.method} ${path} failed: ${res.status} ${text}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}
// presence modal is defined after ensureModalRoot()

// ---- Lightweight modal for weight input (top-level) ----
function ensureModalRoot() {
  if (!document.querySelector('#modal-root')) {
    const root = document.createElement('div');
    root.id = 'modal-root';
    document.body.appendChild(root);
  }
}

// ---- Lightweight modal for presence check (are you still there?) ----
function showPresenceModal({ message = 'Are you still there?', buttonText = "I'm here", onConfirm, onRender } = {}) {
  ensureModalRoot();
  const root = document.querySelector('#modal-root');
  if (!root) return null;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-header">Session Check</div>
    <div class="modal-body">
      <div class="modal-product">${String(message).replace(/</g, '&lt;')}</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary presence-ok">${String(buttonText).replace(/</g, '&lt;')}</button>
    </div>
  `;
  overlay.appendChild(modal);
  root.appendChild(overlay);

  const btnOk = modal.querySelector('.presence-ok');
  const close = () => { try { root.removeChild(overlay); } catch (_) { } };
  if (btnOk) btnOk.addEventListener('click', () => { try { onConfirm && onConfirm(); } finally { close(); } });
  if (onRender) { try { onRender({ close, overlay, modal }); } catch (_) { } }
  return { close, overlay, modal };
}

function showWeightModal({ name, unit, onConfirm }) {
  ensureModalRoot();
  const root = document.querySelector('#modal-root');
  if (!root) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';
  const u = unit || '';
  modal.innerHTML = `
    <div class="modal-header">Enter Weight</div>
    <div class="modal-body">
      <div class="modal-product">${(name || '').replace(/</g, '&lt;')}</div>
      <label class="modal-label">Weight${u ? ' (' + u + ')' : ''}</label>
      <input type="number" class="modal-input" min="0" step="0.01" placeholder="0${u ? ' ' + u : ''}">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary">Cancel</button>
      <button class="btn btn-primary">Add</button>
    </div>
  `;
  overlay.appendChild(modal);
  root.appendChild(overlay);

  const input = modal.querySelector('.modal-input');
  const btnCancel = modal.querySelector('.btn-secondary');
  const btnOk = modal.querySelector('.btn-primary');
  const close = () => { try { root.removeChild(overlay); } catch (_) { } };
  btnCancel.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  btnOk.addEventListener('click', () => {
    const val = Number(input.value);
    if (!val || val <= 0) { input.focus(); return; }
    try { onConfirm && onConfirm(val); } finally { close(); }
  });
  setTimeout(() => { input.focus(); input.select?.(); }, 0);
}

async function fetchProducts({ availability = 'In Stock', limit = 24 } = {}) {
  const params = new URLSearchParams();
  if (availability) params.set('availability', availability);
  if (limit) params.set('limit', String(limit));
  const data = await apiFetch(`/products?${params.toString()}`);
  return Array.isArray(data.items) ? data.items : [];
}

// Fetch products by IDs without loading the entire catalog
async function fetchProductsByIds(ids = []) {
  const unique = Array.from(new Set(ids)).filter(Boolean).map(String);
  if (unique.length === 0) return [];

  // 1) Preferred: GET /products?ids=ID1,ID2,...
  try {
    const params = new URLSearchParams();
    params.set('ids', unique.join(','));
    const data = await apiFetch(`/products?${params.toString()}`);
    if (data && Array.isArray(data.items)) return data.items;
  } catch (_) { }

  // 2) Alternative: POST /products/by-ids { ids: [...] }
  try {
    const data = await apiFetch(`/products/by-ids`, { method: 'POST', body: { ids: unique } });
    if (data && Array.isArray(data.items)) return data.items;
    if (Array.isArray(data)) return data; // some backends may return array directly
  } catch (_) { }

  // 3) Fallback: GET each /products/{id} with limited concurrency
  const results = [];
  const concurrency = 8;
  let i = 0;
  async function next() {
    const idx = i++;
    if (idx >= unique.length) return;
    const id = encodeURIComponent(unique[idx]);
    try {
      const item = await apiFetch(`/products/${id}`);
      if (item) results.push(item);
    } catch (_) { }
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, next));
  return results;
}

async function getImageUrlForKey(key) {
  if (!key) return null;
  try {
    const data = await apiFetch('/image-url', { method: 'POST', body: { key } });
    return data && data.url ? data.url : null;
  } catch (e) {
    console.warn('image-url failed for key', key, e);
    return null;
  }
}

function productCardHTML(p) {
  const price = (p.price != null) ? `$${Number(p.price).toFixed(2)}` : '';
  const unit = p.priceUnit ? `/${p.priceUnit}` : '';
  const status = p.availability || '';
  const name = p.name || '';
  const area = p.areaLocation || '';
  const idAttr = p.id ? ` data-id="${String(p.id)}"` : '';
  const nameAttr = name ? ` data-name="${String(name).replace(/"/g, '&quot;')}"` : '';
  const priceAttr = (p.price != null) ? ` data-price="${Number(p.price)}"` : '';
  const areaAttr = area ? ` data-area="${area}"` : '';
  const unitAttr = p.priceUnit ? ` data-unit="${String(p.priceUnit)}"` : '';
  const scaleAttr = p.scaleNeed ? ` data-scale="1"` : ' data-scale="0"';
  return `
      <div class="product-card"${idAttr}${nameAttr}${priceAttr}${areaAttr}${unitAttr}${scaleAttr}>
        <div class="product-info">
          <div class="product-image"></div>
          <div class="product-name">${name}</div>
          <div class="product-price">${price}${unit}</div>
          <div class="product-status">${status}</div>
        </div>
      </div>`;
}

async function renderProductsToGrid(gridEl, items) {
  if (!gridEl) return;
  gridEl.innerHTML = items.map(productCardHTML).join('');
  // Bind add-to-cart interactions for this grid
  try { bindGridForCart(gridEl); } catch (_) { }
  // Resolve images asynchronously
  const cards = Array.from(gridEl.querySelectorAll('.product-card'));
  await Promise.all(cards.map(async (card, idx) => {
    const p = items[idx];
    const key = Array.isArray(p.imageKeys) && p.imageKeys.length ? p.imageKeys[0] : null;
    let url = null;
    // Prefer existing API image resolver when key is provided
    if (key) {
      url = await getImageUrlForKey(key);
    } else if (p.image_url) {
      // image_url may be a full URL OR an external key that the API can sign
      if (/^https?:\/\//i.test(p.image_url)) {
        url = p.image_url;
      } else {
        try { url = await getImageUrlForKey(p.image_url); } catch { }
      }
    }
    const imgDiv = card.querySelector('.product-image');
    if (imgDiv) {
      // If Supabase storage path provided, attempt signed URL
      if (!url && p.image_url && typeof p.image_url === 'string' && window.sb) {
        try {
          // Expect p.image_url like: 'cabinet-uploads/<uid>/file.jpg' or full URL
          if (/^https?:\/\//i.test(p.image_url)) {
            url = p.image_url;
          } else {
            const path = p.image_url.replace(/^cabinet-uploads\//, '');
            const { data, error } = await window.sb.storage
              .from('cabinet-uploads')
              .createSignedUrl(path, 3600);
            if (!error && data && data.signedUrl) url = data.signedUrl;
          }
        } catch { }
      }
      if (url) {
        imgDiv.style.backgroundImage = `url('${url}')`;
        imgDiv.style.backgroundSize = 'cover';
        imgDiv.style.backgroundPosition = 'center';
      }
    }
    // add/override location-tag with areaLocation if present
    const area = p.areaLocation;
    if (area) {
      let tag = card.querySelector('.location-tag');
      if (!tag) {
        tag = document.createElement('div');
        tag.className = 'location-tag';
        card.appendChild(tag);
      }
      tag.textContent = area;
    }
  }));
}

// --- Cart (Total sidebar) ---
const CART_KEY = 'nc_cart_v1';
// Per-device identifier for tracking sessions across tabs
const DEVICE_KEY = 'nc_device_id_v1';

let __deviceId = null;
function getDeviceId() {
  if (__deviceId) return __deviceId;
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      // generate a lightweight random id
      const rnd = Math.random().toString(36).slice(2);
      const t = Date.now().toString(36);
      id = `${t}-${rnd}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    __deviceId = id;
    return id;
  } catch (_) {
    // fallback ephemeral id
    __deviceId = 'ephem-' + Math.random().toString(36).slice(2);
    return __deviceId;
  }
}

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

function saveCart(items) {
  try { localStorage.setItem(CART_KEY, JSON.stringify(items || [])); } catch (_) { }
}

function getCartSubtotal() {
  const items = loadCart();
  let subtotal = 0;
  for (const it of items) {
    const line = (Number(it.price) || 0) * (Number(it.qty) || 1);
    subtotal += line;
  }
  return Number(subtotal || 0);
}

// Heartbeat: upsert session row with latest subtotal and last_seen
let __hbScheduled = false;
let __hbLastSubtotal = 0;
async function upsertActiveSession(subtotal) {
  try {
    if (!window.sb) return;
    const { data } = await window.sb.auth.getSession();
    const session = data && data.session;
    const user = session && session.user;
    if (!user) return;
    const deviceId = getDeviceId();
    const email = user.email || null;
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : null;
    await window.sb
      .from('active_sessions')
      .upsert({
        user_id: user.id,
        device_id: deviceId,
        email,
        subtotal: Number(subtotal || 0),
        last_seen: new Date().toISOString(),
        user_agent: ua,
      });
  } catch (_) { }
}

function scheduleHeartbeat(subtotal) {
  __hbLastSubtotal = Number(subtotal || 0);
  if (__hbScheduled) return;
  __hbScheduled = true;
  setTimeout(async () => {
    __hbScheduled = false;
    try { await upsertActiveSession(__hbLastSubtotal); } catch (_) { }
  }, 300);
}

// Set up a realtime watcher that listens for admin-triggered force sign-out
let __forceWatcherInited = false;
async function ensureForceSignoutWatcher() {
  if (__forceWatcherInited) return;
  try {
    if (!window.sb) return;
    const { data } = await window.sb.auth.getSession();
    const user = data?.session?.user;
    if (!user) return;
    const deviceId = getDeviceId();
    const channel = window.sb.channel('active_sessions_watch_' + deviceId)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'active_sessions',
        filter: `user_id=eq.${user.id}`,
      }, async (payload) => {
        try {
          const row = payload?.new || {};
          if (row && row.force_sign_out && row.device_id === deviceId && row.user_id === user.id) {
            // Clear the flag for this row first so future sessions don't instantly sign out
            try {
              await window.sb
                .from('active_sessions')
                .update({ force_sign_out: false })
                .eq('user_id', user.id)
                .eq('device_id', deviceId);
            } catch (_) { }
            // Admin requested sign-out: clear local state and sign out
            try { localStorage.removeItem(CART_KEY); } catch (_) { }
            try { sessionStorage.clear(); } catch (_) { }
            try { await window.sb.auth.signOut({ scope: 'local' }); } catch (_) { }
            // Redirect to sign-in if not already there
            if (!location.pathname.includes('signin.html')) {
              window.location.href = 'signin.html';
            } else {
              // We are already on signin.html, just ensure we are clean
              // No need to reload as it causes a loop if the DB flag isn't cleared fast enough
              console.debug('Force sign-out processed on signin page');
            }
          }
        } catch (_) { }
      })
      .subscribe();
    __forceWatcherInited = true;
    return channel;
  } catch (_) { }
}

function formatMoney(n) {
  const v = Number(n || 0);
  return `$${v.toFixed(2)}`;
}

function renderCart() {
  const container = document.querySelector('.right-section .cart-items');
  const subtotalEl = document.querySelector('.right-section .subtotal-amount');
  if (!container) return;
  const items = loadCart();
  container.innerHTML = '';
  let subtotal = 0;
  items.forEach((it, idx) => {
    const line = (Number(it.price) || 0) * (Number(it.qty) || 1);
    subtotal += line;
    
    if (container) {
      const div = document.createElement('div');
      div.className = 'cart-item';
      const key = (it.id != null) ? String(it.id) : `name:${it.name}`;
      div.setAttribute('data-key', key);
      const qty = Number(it.qty) || 1;
      let labelText = (it.name || 'item');
      if (it.weighted) {
        const shown = qty % 1 === 0 ? qty.toString() : qty.toFixed(3).replace(/\.0+$/, '');
        const u = it.unit ? ` ${it.unit}` : '';
        labelText = `${labelText} ${shown}${u}`;
      } else if (qty > 1) {
        labelText = `${labelText} x${qty}`;
      }
      div.innerHTML = `
          <div class="item-number">${idx + 1}</div>
          <div class="item-label">${labelText}</div>
          <div class="item-price">${formatMoney(line)}</div>
          <button class="remove-item" title="Remove" aria-label="Remove item" data-key="${key}">✕</button>
        `;
      container.appendChild(div);
    }
  });
  if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal);
  // Push a heartbeat with latest subtotal (debounced)
  try { scheduleHeartbeat(subtotal); } catch (_) { }
}

function removeFromCartByKey(key) {
  if (!key) return;
  const items = loadCart();
  const next = items.filter(it => ((it.id != null) ? String(it.id) : `name:${it.name}`) !== key);
  saveCart(next);
  renderCart();
}

function decrementCartItemByKey(key) {
  if (!key) return;
  const items = loadCart();
  let changed = false;
  for (const it of items) {
    const k = (it.id != null) ? String(it.id) : `name:${it.name}`;
    if (k === key) {
      if (it.weighted) {
        // For weighted items, remove entirely instead of decrementing
        const next = items.filter(x => ((x.id != null) ? String(x.id) : `name:${x.name}`) !== key);
        saveCart(next);
        renderCart();
        return 'removed';
      }
      const q = Number(it.qty) || 1;
      if (q > 1) {
        it.qty = q - 1;
        changed = true;
      } else {
        // qty would hit 0: remove entirely
        const next = items.filter(x => ((x.id != null) ? String(x.id) : `name:${x.name}`) !== key);
        saveCart(next);
        renderCart();
        return 'removed';
      }
      break;
    }
  }
  if (changed) {
    saveCart(items);
    renderCart();
    return 'decremented';
  }
  return null;
}

function addToCart({ id, name, price, qty = 1, weighted = false, unit = null, unitPrice = null }) {
  const items = loadCart();
  const key = (id != null) ? String(id) : `name:${name}`;
  const existing = items.find(it => (it.id != null ? String(it.id) : `name:${it.name}`) === key);
  if (existing) {
    if (weighted) {
      // Sum weights when adding the same weighted item again
      const addQty = Number(qty) || 0;
      const perUnit = Number(unitPrice != null ? unitPrice : price) || 0;
      existing.qty = (Number(existing.qty) || 0) + addQty;
      if (!existing.weighted) existing.weighted = true;
      existing.price = perUnit; // keep per-unit price
      if (unit) existing.unit = unit;
    } else {
      existing.qty = (existing.qty || 1) + 1;
    }
  } else {
    if (weighted) {
      items.push({ id, name, price: Number(unitPrice != null ? unitPrice : price) || 0, qty: Number(qty) || 0, weighted: true, unit: unit || null });
    } else {
      items.push({ id, name, price: Number(price) || 0, qty: 1 });
    }
  }
  saveCart(items);
  renderCart();
  // Animate the added item
  try {
    const container = document.querySelector('.right-section .cart-items');
    const el = container ? container.querySelector(`.cart-item[data-key="${CSS.escape(key)}"]`) : null;
    if (el) {
      el.classList.add('added');
      setTimeout(() => el.classList.remove('added'), 350);
    }
  } catch (_) { }
}

// Hoisted function declaration so it can be called before definition
function bindGridForCart(gridEl) {
  if (!gridEl || gridEl.dataset.cartBound === '1') return;
  gridEl.dataset.cartBound = '1';
  // Single click hint
  gridEl.addEventListener('click', (e) => {
    const card = e.target.closest('.product-card');
    if (!card || !gridEl.contains(card)) return;
    try { showHintToast('Double tap to add'); } catch (_) { }
  });
  // Double click add
  gridEl.addEventListener('dblclick', (e) => {
    const card = e.target.closest('.product-card');
    if (!card || !gridEl.contains(card)) return;
    const id = card.getAttribute('data-id');
    const name = card.getAttribute('data-name') || (card.querySelector('.product-name')?.textContent || '').trim();
    const priceAttr = card.getAttribute('data-price');
    let price = priceAttr != null ? Number(priceAttr) : null;
    if (price == null || Number.isNaN(price)) {
      // Parse from visible price text like "$2.00"
      const priceText = (card.querySelector('.product-price')?.textContent || '').replace(/[^0-9.\-]/g, '');
      price = Number(priceText) || 0;
    }
    const needsScale = card.getAttribute('data-scale') === '1';
    const unit = card.getAttribute('data-unit');
    if (needsScale) {
      showWeightModal({
        name, unit, onConfirm: (weightVal) => {
          const w = Number(weightVal);
          if (!w || w <= 0) return; // ignore invalid
          addToCart({ id, name, price, qty: w, weighted: true, unit, unitPrice: price });
        }
      });
    } else {
      addToCart({ id, name, price });
    }
  });
}

// Supabase-backed Cabinet fetch (IDs from Supabase, details from AWS) into sections A1..A10
async function loadCabinetFromSupabase() {
  const sectionIds = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'];
  const grids = Object.fromEntries(sectionIds.map(s => [s, document.getElementById(`grid-${s}`)]));
  const haveAnyGrid = Object.values(grids).some(Boolean);
  if (!haveAnyGrid) return;

  const loading = '<div class="product-card"><div class="product-info"><div class="product-image"></div><div class="product-name">Loading...</div><div class="product-price"></div><div class="product-status"></div></div></div>';
  // Per-section loading placeholders
  for (const s of sectionIds) {
    if (grids[s]) grids[s].innerHTML = loading.repeat(3);
  }

  try {
    if (!window.sb) throw new Error('Supabase not initialized');
    // 1) Get only the user's cabinet IDs (ordered by updated_at desc)
    const { data: cabinetRows, error } = await window.sb
      .from('cabinet_items')
      .select('id, updated_at')
      .order('updated_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    const ids = (cabinetRows || []).map(r => r.id);
    console.debug('[Cabinet] Supabase IDs count:', ids.length, ids.slice(0, 10));
    if (!ids.length) {
      const emptyHtml = '<div style="color:#6b7280;">No saved items yet.</div>';
      for (const s of sectionIds) {
        if (grids[s]) grids[s].innerHTML = emptyHtml;
      }
      return;
    }

    // 2) Fetch full AWS products by those IDs (single batch; backend may return extras)
    let awsItems = await fetchProductsByIds(ids);
    console.debug('[Cabinet] AWS items fetched (raw):', awsItems.length);
    // Enforce strict filter to Supabase IDs
    const idSet = new Set(ids.map(String));
    awsItems = (awsItems || []).filter(p => idSet.has(String(p.id)));
    console.debug('[Cabinet] AWS items after filter:', awsItems.length);

    // 3) Keep the order based on Supabase updated_at
    const orderMap = new Map(ids.map((id, idx) => [String(id), idx]));
    awsItems.sort((a, b) => (orderMap.get(String(a.id)) ?? 0) - (orderMap.get(String(b.id)) ?? 0));

    // 4) Group by areaLocation into sections A1..A10
    const groups = Object.fromEntries(sectionIds.map(s => [s, []]));
    for (const p of awsItems) {
      const raw = (p.areaLocation || p.area || '').toString().trim().toUpperCase();
      const sec = sectionIds.includes(raw) ? raw : 'A1'; // default to A1 if unknown/missing
      groups[sec].push(p);
    }

    // 5) Render into each section grid
    for (const s of sectionIds) {
      const grid = grids[s];
      if (!grid) continue;
      const items = groups[s] || [];
      if (items.length === 0) {
        grid.innerHTML = '<div style="color:#6b7280;">No items in this section.</div>';
      } else {
        await renderProductsToGrid(grid, items);
      }
    }
  } catch (e) {
    console.error('Supabase cabinet load failed', e);
    const err = '<div style="color:#b91c1c;">Failed to load your cabinet.</div>';
    for (const s of Object.keys(grids)) {
      if (grids[s]) grids[s].innerHTML = err;
    }
  }
}

async function loadCabinetSections() {
  try {
    const gridNew = document.getElementById('whats-new-grid');
    const gridTop = document.getElementById('top-selling-grid');
    if (!gridNew && !gridTop) return; // not on cabinet

    // Loading placeholders
    const loading = '<div class="product-card"><div class="product-info"><div class="product-image"></div><div class="product-name">Loading...</div><div class="product-price"></div><div class="product-status"></div></div></div>';
    if (gridNew) gridNew.innerHTML = loading.repeat(3);
    if (gridTop) gridTop.innerHTML = loading.repeat(3);

    const items = await fetchProducts({ availability: 'In Stock', limit: 24 });
    // Derive sections: newest by createdAt for What's New, then next chunk as Top Selling placeholder
    const withDates = items.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const whatsNew = withDates.slice(0, 6);
    const topSelling = withDates.slice(6, 12); // placeholder until backend sections exist

    if (gridNew) await renderProductsToGrid(gridNew, whatsNew);
    if (gridTop) await renderProductsToGrid(gridTop, topSelling);
  } catch (e) {
    console.error('Failed to load cabinet sections', e);
    const gridNew = document.getElementById('whats-new-grid');
    const gridTop = document.getElementById('top-selling-grid');
    const err = '<div style="color:#b91c1c;">Failed to load products.</div>';
    if (gridNew) gridNew.innerHTML = err;
    if (gridTop) gridTop.innerHTML = err;
  }
}
document.addEventListener('DOMContentLoaded', () => {
  // simple debounce helper
  function debounce(fn, wait = 250) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }
  // Small helper: transient hint toast
  let toastTimeoutId = null;
  function showHintToast(message) {
    let toast = document.querySelector('.hint-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'hint-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    if (toastTimeoutId) clearTimeout(toastTimeoutId);
    toastTimeoutId = setTimeout(() => {
      toast.classList.remove('show');
    }, 1300);
  }
  // Initialize cart UI from storage and bind any existing grids
  const isAdminPath = /(^|\/)admin\//.test(location.pathname);
  if (!isAdminPath) {
    try { renderCart(); } catch (_) { }
    // Initialize force sign-out realtime watcher and send an initial heartbeat
    try { ensureForceSignoutWatcher(); } catch (_) { }
    try { upsertActiveSession(getCartSubtotal()); } catch (_) { }
    // Periodic heartbeat to keep last_seen fresh and subtotal up to date
    try {
      setInterval(() => {
        try { upsertActiveSession(getCartSubtotal()); } catch (_) { }
      }, 20000);
    } catch (_) { }
    // Ensure weight modal root exists
    try { ensureModalRoot(); } catch (_) { }
    try {
      const gridsNow = document.querySelectorAll('.products-grid');
      gridsNow.forEach(g => { try { bindGridForCart(g); } catch (_) { } });
    } catch (_) { }
    // Handle cart remove button clicks (delegated)
    try {
      const cartList = document.querySelector('.right-section .cart-items');
      if (cartList) {
        cartList.addEventListener('click', (e) => {
          const btn = e.target.closest('.remove-item');
          if (!btn || !cartList.contains(btn)) return;
          const key = btn.getAttribute('data-key');
          const row = btn.closest('.cart-item');
          // Determine current qty from storage
          let qty = 1;
          let isWeighted = false;
          try {
            const items = loadCart();
            const it = items.find(x => ((x.id != null) ? String(x.id) : `name:${x.name}`) === key);
            qty = Number(it?.qty) || 1;
            isWeighted = !!it?.weighted;
          } catch (_) { }

          // Weighted items: remove entire line immediately
          if (isWeighted) {
            if (row) {
              row.classList.add('removing');
              setTimeout(() => removeFromCartByKey(key), 190);
            } else {
              removeFromCartByKey(key);
            }
            return;
          }

          if (qty > 1) {
            // Decrement and pulse row
            decrementCartItemByKey(key);
            try {
              const container = document.querySelector('.right-section .cart-items');
              const el = container ? container.querySelector(`.cart-item[data-key="${CSS.escape(key)}"]`) : null;
              if (el) {
                el.classList.add('added');
                setTimeout(() => el.classList.remove('added'), 350);
              }
            } catch (_) { }
          } else {
            // Animate out then remove
            if (row) {
              row.classList.add('removing');
              setTimeout(() => removeFromCartByKey(key), 190);
            } else {
              removeFromCartByKey(key);
            }
          }
        });
      }
    } catch (_) { }
    // Add click functionality to product cards (category view)
    document.querySelectorAll('.product-card').forEach(card => {
      card.addEventListener('click', function () {
        const nameEl = this.querySelector('.product-name');
        if (nameEl) console.log('Product clicked:', nameEl.textContent.trim());
      });
    });
  }

  // Inactivity monitor (non-admin pages only)
  try {
    const isAdminPath = /(^|\/)admin\//.test(location.pathname);
    const isAdminMode = new URLSearchParams(window.location.search).has('admin');
    
    if (!isAdminPath && !isAdminMode) {
      let idleTimer = null;
      let graceTimer = null;
      let presenceShown = false;
      let presenceHandle = null;
      let isUserSignedIn = false;

      const AUTH_IDLE_MS = 8 * 60 * 1000;    // 8 mins for signed-in users
      const AUTH_GRACE_MS = 60 * 1000;       // 1 min grace to respond
      const GUEST_IDLE_MS = 3 * 60 * 1000;   // 3 mins for non-signed-in users

      const clearPresence = () => {
        if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
        if (presenceHandle && typeof presenceHandle.close === 'function') {
          try { presenceHandle.close(); } catch (_) { }
        }
        presenceHandle = null;
        presenceShown = false;
      };

      const signOutForInactivity = async () => {
        try { localStorage.removeItem('nc_cart_v1'); } catch (_) { }
        try { sessionStorage.clear(); } catch (_) { }
        if (window.sb) {
          try { await window.sb.auth.signOut({ scope: 'local' }); } catch (_) { }
        }
        window.location.href = 'signin.html?reason=inactive';
      };

      const handleIdleTimeout = () => {
        if (isUserSignedIn) {
          // Signed-in user: Show presence modal
          presenceShown = true;
          presenceHandle = showPresenceModal({
            message: 'Are you still there? We will sign you out for security if you are inactive.',
            buttonText: "I'm here",
            onConfirm: () => {
              clearPresence();
              resetIdleTimer();
            },
          });

          // Fallback if modal fails
          if (!presenceHandle) {
            const confirmed = window.confirm('Are you still there? You will be signed out for security if inactive.');
            if (confirmed) {
              clearPresence();
              resetIdleTimer();
            } else {
              signOutForInactivity();
            }
            return;
          }

          // Start grace period
          graceTimer = setTimeout(() => {
            if (!presenceShown) return;
            clearPresence();
            signOutForInactivity();
          }, AUTH_GRACE_MS);

        } else {
          // Guest user: Redirect to idle loop immediately (no prompt)
          window.location.href = 'image.html';
        }
      };

      const resetIdleTimer = () => {
        clearPresence();
        if (idleTimer) clearTimeout(idleTimer);
        
        // Determine timeout based on auth state
        const timeout = isUserSignedIn ? AUTH_IDLE_MS : GUEST_IDLE_MS;
        idleTimer = setTimeout(handleIdleTimeout, timeout);
      };

      const initMonitor = async () => {
        // Check auth status
        if (window.sb) {
          try {
            const { data } = await window.sb.auth.getSession();
            isUserSignedIn = !!(data && data.session);
          } catch (_) {
            isUserSignedIn = false;
          }
        }

        // Force "not signed in" state on auth pages to ensure 3-minute idle loop
        // prevents race conditions where session tracking might lag during sign-out
        const isAuthPage = location.pathname.includes('signin.html') || location.pathname.includes('create-account.html');
        if (isAuthPage) {
          isUserSignedIn = false;
        }
        
        // Setup listeners
        const activityEvents = ['click', 'mousemove', 'keydown', 'touchstart', 'scroll', 'focus'];
        activityEvents.forEach(ev => window.addEventListener(ev, resetIdleTimer, { passive: true }));
        
        // Start monitoring
        resetIdleTimer();
      };

      initMonitor();
    }
  } catch (_) { }

  // Add click functionality to checkout button
  const checkoutBtn = document.querySelector('.checkout-btn');
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', async function () {
      // Redirect to dedicated checkout page for embedded flow
      if (!location.pathname.includes('checkout.html')) {
        window.location.href = 'checkout.html';
        return;
      }
      // Fallback for hosted behavior if ever needed
      try {
        await startCheckout();
      } catch (e) {
        console.error('Checkout failed', e);
        try { showHintToast('Checkout failed'); } catch (_) { }
      }
    });
  }

  // Add click functionality to search icon (category view)
  // Search interactions
  document.addEventListener('click', (e) => {
    const searchIcon = e.target.closest('.search-icon');
    const searchInput = document.querySelector('.search-input');
    const sectionHeader = document.querySelector('.section-header');
    const leftSection = document.querySelector('.left-section');

    if (searchIcon && searchInput && sectionHeader) {
      searchInput.classList.toggle('expanded');
      sectionHeader.classList.toggle('expanded');

      if (leftSection) {
        if (searchInput.classList.contains('expanded')) {
          leftSection.classList.add('searching');
          setTimeout(() => searchInput.focus(), 100);
        } else {
          leftSection.classList.remove('searching');
        }
      }
    }
  });

  // Collapse search when clicking outside
  document.addEventListener('mousedown', (e) => {
    const searchContainer = e.target.closest('.search-container');
    const vkKeyboard = e.target.closest('.vk') || e.target.closest('#vk-cabinet');
    const searchInput = document.querySelector('.search-input');
    const sectionHeader = document.querySelector('.section-header');
    const leftSection = document.querySelector('.left-section');

    if (!searchContainer && !vkKeyboard && searchInput && searchInput.classList.contains('expanded')) {
      searchInput.classList.remove('expanded');
      if (sectionHeader) sectionHeader.classList.remove('expanded');
      if (leftSection) leftSection.classList.remove('searching');
    }
  });

  // Index page: bind to existing static category cards (preserve original look)
  if (document.body.classList.contains('index')) {
    const cards = document.querySelectorAll('.category-card');
    let navigating = false;
    cards.forEach(card => {
      const titleEl = card.querySelector('.category-title');
      const title = titleEl ? titleEl.textContent.trim() : '';
      // Single click: show hint to double tap
      card.addEventListener('click', () => {
        if (navigating) return;
        showHintToast('Tap twice to open');
      });
      // Double click: navigate to category page
      card.addEventListener('dblclick', () => {
        if (navigating) return;
        navigating = true;
        const q = title ? ('?name=' + encodeURIComponent(title)) : '';
        if (title) { try { sessionStorage.setItem('lastCategoryName', title); } catch { } }
        try { sessionStorage.setItem('lastView', 'category'); } catch { }
        document.body.classList.add('page-exit-right');
        setTimeout(() => { window.location.href = 'category.html' + q; }, 280);
      });
    });
  } else {
    // Non-index pages
    const isCabinetPage = /(^|\/)cabinet\.html(\?|$)/.test(location.pathname) || document.title === 'Cabinet';
    const isCategoryPage = /(^|\/)category\.html(\?|$)/.test(location.pathname);

    // Category page only: set title from query parameter
    if (!isCabinetPage) {
      const params = new URLSearchParams(window.location.search);
      const name = params.get('name');
      const heading = document.querySelector('.section-title');
      const catTabLabel = document.querySelector('.category-tab-label');
      const text = name && name.length ? name : 'Category';
      if (heading) heading.textContent = text;
      if (catTabLabel) catTabLabel.textContent = text;
      document.title = text;

      // store last category for later navigation from cabinet
      if (name) {
        try { sessionStorage.setItem('lastCategoryName', name); } catch { }
      }
      try { sessionStorage.setItem('lastView', 'category'); } catch { }
    }

    // Back button: animate then navigate back to index
    // Back button: animate then navigate back to index
    // Back button: animate then navigate back to index
    const setupBack = () => {
      const backBtn = document.querySelector('.back-btn');
      if (backBtn) {
        backBtn.addEventListener('click', (e) => {
          e.preventDefault();
          document.body.classList.add('page-exit-right');
          setTimeout(() => {
            const currentPath = window.location.pathname;
            const newPath = currentPath.substring(0, currentPath.lastIndexOf('/') + 1) + 'index.html';
            window.location.href = newPath;
          }, 280);
        });
      }
    };
    setupBack();

    // Add location tag to each product card (placeholder "A1")
    const productCards = document.querySelectorAll('.products-grid .product-card');
    productCards.forEach((card) => {
      if (!card.querySelector('.location-tag')) {
        const tag = document.createElement('div');
        tag.className = 'location-tag';
        const area = card.getAttribute('data-area');
        tag.textContent = area && area.length ? area : 'A1';
        card.appendChild(tag);
      }
    });

    // Cabinet data load (prefer Supabase if available)
    if (isCabinetPage) {
      const sectionIds = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'];
      const showConnectMsg = (msg = 'Connect to view your cabinet.') => {
        for (const s of sectionIds) {
          const grid = document.getElementById(`grid-${s}`);
          if (grid) grid.innerHTML = `<div style="color:#6b7280;">${msg}</div>`;
        }
      };

      async function tryLoadCabinetWithWait(maxMs = 3000) {
        const start = Date.now();
        while (!window.sb && (Date.now() - start) < maxMs) {
          await new Promise(r => setTimeout(r, 100));
        }
        if (!window.sb) {
          showConnectMsg('Supabase not initialized. Please refresh.');
          return;
        }
        try {
          await loadCabinetFromSupabase();
        } catch (e) {
          console.error('Cabinet load error', e);
          showConnectMsg('Failed to load your cabinet.');
        }
      }

      tryLoadCabinetWithWait();
    }

    // Category data load: fetch & render only selected category, wire search filter
    if (isCategoryPage) {
      const params = new URLSearchParams(window.location.search);
      const cat = params.get('name');
      const grid = document.querySelector('.products-grid');
      const input = document.querySelector('.search-input');
      let allCatItems = [];
      (async () => {
        if (!grid) return;
        grid.innerHTML = '<div class="product-card"><div class="product-info"><div class="product-image"></div><div class="product-name">Loading...</div></div></div>';
        try {
          const items = await fetchProducts({ availability: 'In Stock', limit: 200 });
          allCatItems = items.filter(p => (p.category || '').trim() === (cat || '').trim());
          await renderProductsToGrid(grid, allCatItems);
          // wire live filtering
          if (input) {
            const applyFilter = () => {
              const q = (input.value || '').trim().toLowerCase();
              if (!q) {
                renderProductsToGrid(grid, allCatItems);
                return;
              }
              const filtered = allCatItems.filter(p =>
                (p.name && p.name.toLowerCase().includes(q)) ||
                (p.barcode && String(p.barcode).toLowerCase().includes(q))
              );
              renderProductsToGrid(grid, filtered);
            };
            input.addEventListener('input', debounce(applyFilter, 200));
          }
        } catch (e) {
          console.error('Failed to load category products', e);
          grid.innerHTML = '<div style="color:#b91c1c;">Failed to load products.</div>';
        }
      })();
    }
  }

  // Tab interactions (shared): toggle active state between left title and Cabinet
  const tabbar = document.querySelector('.tabbar');
  if (tabbar) {
    const tabs = Array.from(tabbar.querySelectorAll('.tab'));
    const isIndex = document.body.classList.contains('index');
    const isCabinet = /(^|\/)cabinet\.html(\?|$)/.test(location.pathname) || document.title === 'Cabinet';
    const isCategory = /(^|\/)category\.html(\?|$)/.test(location.pathname);

    // On cabinet, label the first tab with last selected category name if available
    if (isCabinet) {
      try {
        const lastView = sessionStorage.getItem('lastView');
        const lastName = sessionStorage.getItem('lastCategoryName');
        const firstTabSpan = tabs[0]?.querySelector('span');
        if (firstTabSpan) {
          if (lastView === 'category' && lastName) {
            firstTabSpan.textContent = lastName;
          } else {
            firstTabSpan.textContent = 'Pick A Category';
          }
        }
      } catch { }
    }

    let tabNavigating = false;
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        if (tabNavigating) return;
        const label = (tab.textContent || '').trim().toLowerCase();
        const idx = tabs.indexOf(tab);

        let dest = null;
        // On cabinet, first tab always returns to last category if available
        if (isCabinet && idx === 0) {
          let lastView = null, lastName = null;
          try {
            lastView = sessionStorage.getItem('lastView');
            lastName = sessionStorage.getItem('lastCategoryName');
          } catch { }
          if (lastView === 'category' && lastName) {
            dest = 'category.html?name=' + encodeURIComponent(lastName);
          } else {
            dest = 'index.html';
          }
        } else if (label.includes('cabinet')) {
          // Mark where we came from before going to cabinet
          try {
            if (isIndex) sessionStorage.setItem('lastView', 'index');
            else if (isCategory) sessionStorage.setItem('lastView', 'category');
          } catch { }
          dest = 'cabinet.html';
        } else if (label.includes('category') || label.includes('pick a category')) {
          // On cabinet: go back to the last selected category if known, else index
          // On category: stay put
          if (isCabinet) {
            let lastView = null, lastName = null;
            try {
              lastView = sessionStorage.getItem('lastView');
              lastName = sessionStorage.getItem('lastCategoryName');
            } catch { }
            if (lastView === 'category' && lastName) dest = 'category.html?name=' + encodeURIComponent(lastName);
            else dest = 'index.html';
          } else if (isIndex || isCategory) {
            dest = null;
          } else {
            dest = 'index.html';
          }
        }

        if (dest) {
          tabNavigating = true;
          document.body.classList.add('page-exit-right');
          setTimeout(() => { window.location.href = dest; }, 280);
          return;
        }

        // Fallback: local active toggle only
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      });
    });
  }

  // Refunds page wiring: search transcript and refund individual items
  try {
    const isRefunds = document.body.classList.contains('refunds') || /(^|\/)refund\.html(\?|$)/.test(location.pathname);
    if (isRefunds) {
      const form = document.getElementById('refund-search-form');
      const input = document.getElementById('refund-transcript');
      const tbody = document.getElementById('refund-items-body');
      const summary = document.getElementById('refund-summary');
      const subsummary = document.getElementById('refund-subsummary');
      const statusEl = document.getElementById('refund-status');

      let current = null; // { transcript_no, currency, total_cents, items: [{name, qty, amount_cents}] }

      const fmt = (cents, cur = 'USD') => {
        const n = Number(cents || 0) / 100;
        try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(cur).toUpperCase() }).format(n); } catch { return `$${n.toFixed(2)}`; }
      };
      const setStatus = (msg, kind = 'info') => {
        if (!statusEl) return;
        statusEl.textContent = msg || '';
        statusEl.style.color = kind === 'error' ? '#b91c1c' : kind === 'success' ? '#065f46' : '#6b7280';
      };

      function renderItems() {
        if (!tbody) return;
        if (!current || !Array.isArray(current.items) || current.items.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" style="padding:16px; color:#6b7280;">No items found for this transcript.</td></tr>';
          return;
        }
        tbody.innerHTML = '';
        current.items.forEach((it, idx) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="padding:10px 12px; border-bottom:1px solid #e5e7eb;">${(it.name || 'Item')}</td>
            <td style="padding:10px 12px; border-bottom:1px solid #e5e7eb;">${it.qty ?? 1}</td>
            <td style="padding:10px 12px; border-bottom:1px solid #e5e7eb;">${fmt(it.amount_cents, current.currency)}</td>
            <td style="padding:10px 12px; border-bottom:1px solid #e5e7eb;">
              <button class="btn btn-secondary" data-refund-idx="${idx}">Refund</button>
            </td>
          `;
          tbody.appendChild(tr);
        });

        tbody.querySelectorAll('[data-refund-idx]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const idx = Number(btn.getAttribute('data-refund-idx')) || 0;
            const item = current.items[idx];
            if (!item) return;
            setStatus('Processing refund...', 'info');
            try {
              let ok = false; let message = '';
              if (window.sb?.functions?.invoke) {
                const { data, error } = await window.sb.functions.invoke('refunds-create', {
                  body: { transcript_no: current.transcript_no, item_index: idx, amount_cents: item.amount_cents }
                });
                if (error) throw error;
                ok = !!data?.ok; message = data?.message || '';
              } else {
                const data = await apiFetch('/refunds/create', { method: 'POST', body: { transcript_no: current.transcript_no, item_index: idx, amount_cents: item.amount_cents } });
                ok = !!data?.ok; message = data?.message || '';
              }
              if (ok) setStatus(message || 'Refund created.', 'success');
              else setStatus(message || 'Refund failed.', 'error');
            } catch (e) {
              console.error('Refund failed', e);
              setStatus('Refund failed: ' + (e?.message || e), 'error');
            }
          });
        });
      }

      async function searchTranscript(noRaw) {
        const no = String(noRaw || '').trim().replace(/^#?/, '');
        if (!no) return;
        setStatus('Searching...', 'info');
        try {
          let result = null;
          if (window.sb?.functions?.invoke) {
            const { data, error } = await window.sb.functions.invoke('refunds-search', { body: { transcript_no: no } });
            if (error) throw error;
            result = data;
          } else {
            result = await apiFetch(`/refunds/search?transcript_no=${encodeURIComponent(no)}`);
          }
          if (!result || !result.transcript_no) {
            current = null;
            if (summary) summary.textContent = 'No transcript found';
            if (subsummary) subsummary.textContent = '';
            renderItems();
            setStatus('Not found', 'error');
            return;
          }
          current = result;
          if (summary) summary.textContent = `Transcript ${result.transcript_no}`;
          if (subsummary) subsummary.textContent = `${(result.items?.length || 0)} items • Total ${fmt(result.total_cents || 0, result.currency || 'USD')}`;
          setStatus('Loaded', 'success');
          renderItems();
        } catch (e) {
          console.error('Search failed', e);
          current = null;
          if (summary) summary.textContent = 'Search failed';
          if (subsummary) subsummary.textContent = '';
          renderItems();
          setStatus('Error: ' + (e?.message || e), 'error');
        }
      }

      if (form && input) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const value = input.value;
          if (value) searchTranscript(value);
        });
      }
    }
  } catch { }
});



// ---- Stripe Checkout wiring ----
async function startCheckout(options = {}) {
  const { embedded = false } = options;
  const items = loadCart();
  if (!items || items.length === 0) {
    try { showHintToast('Your cart is empty'); } catch (_) { }
    return;
  }

  // Compute subtotal in cents and build lightweight line items
  let subtotalCents = 0;
  const lines = items.map((it) => {
    const price = Number(it.price) || 0; // per-unit price for weighted as well
    const qty = Number(it.qty) || 1;     // may be non-integer for weighted
    const lineTotal = price * qty;
    subtotalCents += Math.round(lineTotal * 100);

    // Stripe quantity must be integer; for weighted items we send quantity 1 and the total as unit_amount
    if (it.weighted) {
      return {
        name: it.name || 'Item',
        quantity: 1,
        amount_cents: Math.max(0, Math.round(lineTotal * 100)),
        metadata: {
          id: it.id != null ? String(it.id) : undefined,
          weighted: '1',
          unit: it.unit || '',
          qty: String(qty)
        }
      };
    }
    return {
      name: it.name || 'Item',
      quantity: Math.max(1, Math.round(qty)),
      amount_cents: Math.max(0, Math.round(price * 100)),
      metadata: {
        id: it.id != null ? String(it.id) : undefined,
      }
    };
  });

  // Build redirect URLs
  const origin = window.location.origin;
  const success_url = origin + '/receipt.html?session_id={CHECKOUT_SESSION_ID}';
  const cancel_url = window.location.href; // stay on the same page on cancel

  // Get user to associate receipt (optional, but useful for backend)
  let user_id = null; let user_email = null;
  try {
    if (window.sb) {
      const { data: u } = await window.sb.auth.getUser();
      user_id = u?.user?.id || null;
      user_email = u?.user?.email || null;
    }
  } catch { }

  const payload = {
    currency: 'usd',
    items: lines,
    subtotal_cents: Math.max(0, subtotalCents),
    success_url,
    cancel_url,
    ui_mode: embedded ? 'embedded' : 'hosted',
    customer_hint: { user_id, user_email }
  };

  // Prefer Supabase edge function; fallback to API_BASE if present
  let resp = null;
  try {
    if (window.sb?.functions?.invoke) {
      const { data, error } = await window.sb.functions.invoke('stripe-create-session', { body: payload });
      if (error) throw error;
      resp = data;
    }
  } catch (e) {
    console.warn('Supabase stripe-create-session failed, trying API fallback', e);
  }
  if (!resp) {
    try {
      resp = await apiFetch('/stripe/create-session', { method: 'POST', body: payload });
    } catch (e) {
      console.error('API stripe/create-session failed', e);
      throw e;
    }
  }

  if (embedded) {
    return resp;
  }

  const url = resp?.url;
  const sessionId = resp?.id || resp?.session_id;
  if (url) {
    // Redirect to Stripe Checkout
    window.location.href = url;
    return;
  }
  // If no URL, but session returned, we could use Stripe.js redirect (not included). For now, error.
  throw new Error('No checkout URL returned');
}

// Checkout Page wiring (Embedded)
document.addEventListener('DOMContentLoaded', async () => {
  const isCheckout = /(^|\/)checkout\.html(\?|$)/.test(location.pathname) || document.body.classList.contains('checkout');
  if (!isCheckout) return;

  const mountEl = document.getElementById('checkout-mount');
  if (!mountEl) return;

  // Fetch Publishable Key from backend
  let pk = (window.APP_CONFIG && window.APP_CONFIG.STRIPE_PUBLISHABLE_KEY) || '';
  if (!pk || pk.includes('replace_me')) {
    try {
      if (window.sb?.functions?.invoke) {
        console.log('[Checkout] Fetching PK from Supabase function...');
        const { data, error } = await window.sb.functions.invoke('stripe-create-session', { method: 'GET' });
        if (error) {
          console.error('[Checkout] Supabase function error:', error);
        } else {
          console.log('[Checkout] Supabase function data:', data);
          if (data?.publishableKey) {
            pk = data.publishableKey;
          }
        }
      } else {
        // Fallback fetch
        console.log('[Checkout] Fetching PK from API fallback...');
        const res = await apiFetch('/stripe/create-session', { method: 'GET' });
        console.log('[Checkout] API fallback data:', res);
        if (res?.publishableKey) pk = res.publishableKey;
      }
    } catch (e) {
      console.warn('Failed to fetch Stripe config', e);
    }
  }

  if (!pk || pk.includes('replace_me')) {
    console.error('[Checkout] Missing Publishable Key. Ensure STRIPE_PUBLISHABLE_KEY is set in Supabase Secrets.');
    mountEl.innerHTML = '<div style="color:#b91c1c;text-align:center;">Stripe Configuration Error: Missing Publishable Key<br><span style="font-size:0.8em;color:#666">Check console for details (F12)</span></div>';
    return;
  }



  if (typeof Stripe === 'undefined') {
    mountEl.innerHTML = '<div style="color:#b91c1c;text-align:center;">Failed to load Stripe.js</div>';
    return;
  }

  try {
    // Initialize Stripe
    const stripe = Stripe(pk);

    // Create session
    const sessionData = await startCheckout({ embedded: true });
    const clientSecret = sessionData?.client_secret;

    if (!clientSecret) {
      throw new Error('No client_secret returned from backend');
    }

    // Mount checkout
    const checkout = await stripe.initEmbeddedCheckout({
      clientSecret,
    });
    checkout.mount('#checkout-mount');

  } catch (e) {
    console.error('Embedded checkout failed', e);
    mountEl.innerHTML = `<div style="color:#b91c1c;text-align:center;">Failed to initialize checkout: ${e.message || 'Unknown error'}<br><span style="font-size:0.8em;color:#666">Check console for details (F12)</span></div>`;
  }
});

// Receipt page: fetch session details and render summary
document.addEventListener('DOMContentLoaded', () => {
  const isReceipt = /(^|\/)receipt\.html(\?|$)/.test(location.pathname) || document.body.classList.contains('receipt');
  if (!isReceipt) return;

  const params = new URLSearchParams(window.location.search);
  const sid = params.get('session_id');
  const receiptContainer = document.getElementById('receipt-container');
  const statusEl = document.getElementById('receipt-status');

  const setStatus = (msg, kind = 'info') => {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = kind === 'error' ? '#b91c1c' : kind === 'success' ? '#065f46' : '#6b7280';
  };

  async function fetchDetails(sessionId) {
    if (!sessionId) {
      setStatus('Missing session', 'error');
      return;
    }
    setStatus('Loading receipt...', 'info');
    try {
      let data = null;
      if (window.sb?.functions?.invoke) {
        const { data: d, error } = await window.sb.functions.invoke('stripe-session-details', { body: { session_id: sessionId } });
        if (error) throw error;
        data = d;
      } else {
        data = await apiFetch(`/stripe/session-details?session_id=${encodeURIComponent(sessionId)}`);
      }
      if (!data) throw new Error('No details');

      // Render a basic summary
      if (receiptContainer) {
        const currency = (data.currency || 'USD').toUpperCase();
        const fmt = (cents) => {
          const n = Number(cents || 0) / 100;
          try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n); } catch { return `$${n.toFixed(2)}`; }
        };
        const lines = Array.isArray(data.items) ? data.items : [];
        const total = data.amount_total_cents ?? data.amount_total ?? 0;
        const sub = data.amount_subtotal_cents ?? data.amount_subtotal ?? null;

        const itemsHtml = lines.map((it, idx) => {
          const name = it.name || `Item ${idx + 1}`;
          const qty = it.quantity ?? 1;
          const amt = it.amount_cents ?? it.unit_amount_cents ?? 0;
          return `<div class="cart-item"><div class="item-number">${idx + 1}</div><div class="item-label">${name}${qty > 1 ? ' x' + qty : ''}</div><div class="item-price">${fmt(amt * (qty || 1))}</div></div>`;
        }).join('');

        receiptContainer.innerHTML = `
          <div class="cart-items">${itemsHtml || '<div style=\"color:#6b7280;\">No items</div>'}</div>
          <div class="subtotal"><span class="subtotal-label">Total:</span><span class="subtotal-amount">${fmt(total)}</span></div>
        `;
      }

      // Store receipt under user's account in Supabase (best-effort)
      try {
        if (window.sb) {
          const { data: u } = await window.sb.auth.getUser();
          const uid = u?.user?.id || null;
          if (uid) {
            const currency = (data.currency || 'USD').toUpperCase();
            const session_id = data.id || sessionId;
            const amount_total_cents = Number(data.amount_total_cents ?? data.amount_total ?? 0) || 0;
            const items = Array.isArray(data.items) ? data.items : [];
            await window.sb.from('receipts').upsert(
              { user_id: uid, session_id, currency, amount_total_cents, items },
              { onConflict: 'session_id' }
            );
          }
        }
      } catch (e) {
        console.warn('Failed to store receipt in Supabase (non-fatal)', e);
      }

      // Clear cart after a successful checkout
      try { saveCart([]); renderCart(); } catch { }
      setStatus('Payment complete', 'success');
    } catch (e) {
      console.error('Failed to load receipt', e);
      setStatus('Failed to load receipt', 'error');
    }
  }

  fetchDetails(sid);
});
