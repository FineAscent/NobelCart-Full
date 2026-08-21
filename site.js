// --- API helpers ---
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || '';
const CART_ID = (function () {
  // cart-id.js owns this when it is loaded; the rest is a fallback for pages that
  // do not include it. localStorage is checked so the id survives a browser restart.
  if (typeof window.ncCartId === 'function') return window.ncCartId();
  var id = new URLSearchParams(window.location.search).get('cart') || '';
  if (!id) { try { id = localStorage.getItem('nc_cart_id') || ''; } catch (_) {} }
  if (!id) { try { id = sessionStorage.getItem('nc_cart_id') || ''; } catch (_) {} }
  if (id) {
    try { localStorage.setItem('nc_cart_id', id); } catch (_) {}
    try { sessionStorage.setItem('nc_cart_id', id); } catch (_) {}
  }
  return id;
})();
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
function showPresenceModal({ message = 'Are you still there?', buttonText = "I'm here", countdownSec = 0, onConfirm, onRender } = {}) {
  ensureModalRoot();
  const root = document.querySelector('#modal-root');
  if (!root) return null;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay presence-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal presence-modal';
  const safeMsg = String(message).replace(/</g, '&lt;');
  const safeBtn = String(buttonText).replace(/</g, '&lt;');
  modal.innerHTML = `
    <div class="modal-header">Still there?</div>
    <div class="modal-body">
      <div class="modal-product">${safeMsg}</div>
      ${countdownSec > 0 ? `<div class="presence-countdown" aria-live="polite">Signing out in <strong>${countdownSec}</strong>s</div>` : ''}
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary presence-ok">${safeBtn}</button>
    </div>
  `;
  overlay.appendChild(modal);
  root.appendChild(overlay);

  let tick = null;
  const countdownEl = modal.querySelector('.presence-countdown strong');
  if (countdownEl && countdownSec > 0) {
    let left = countdownSec;
    tick = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(tick);
        tick = null;
        return;
      }
      countdownEl.textContent = String(left);
    }, 1000);
  }

  const btnOk = modal.querySelector('.presence-ok');
  const close = () => {
    if (tick) { clearInterval(tick); tick = null; }
    try { root.removeChild(overlay); } catch (_) { }
  };
  if (btnOk) btnOk.addEventListener('click', () => { try { onConfirm && onConfirm(); } finally { close(); } });
  if (onRender) { try { onRender({ close, overlay, modal }); } catch (_) { } }
  return { close, overlay, modal };
}

function showAllergyModal({ name, allergyText, onConfirm }) {
  ensureModalRoot();
  const root = document.querySelector('#modal-root');
  if (!root) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';

  modal.innerHTML = `
    <div class="modal-header">Allergy Caution</div>
    <div class="modal-body" style="padding: 24px 16px;">
      <div class="modal-product" style="font-weight:600; font-size:1.1rem; margin-bottom:12px; color:#111827;">
        ${(name || '').replace(/</g, '&lt;')}
      </div>
      <div style="font-size:1rem; color:#374151; line-height:1.5;">
        Please note this item contains:
        <div style="font-weight:600; color:#000; margin-top:4px; font-size:1.05rem;">
          ${String(allergyText).replace(/</g, '&lt;')}
        </div>
      </div>
    </div>
    <div class="modal-actions" style="justify-content:center; padding-bottom:20px;">
      <button class="btn btn-primary" style="min-width: 100px;">OK</button>
    </div>
  `;
  overlay.appendChild(modal);
  root.appendChild(overlay);

  const btnOk = modal.querySelector('.btn-primary');
  const close = () => { try { root.removeChild(overlay); } catch (_) { } };

  btnOk.addEventListener('click', () => {
    try { onConfirm && onConfirm(); } finally { close(); }
  });

  // Focus OK
  setTimeout(() => btnOk.focus(), 50);
}

async function showWeightModal({ name, unit, pricePerUnit, onConfirm }) {
  ensureModalRoot();
  const root = document.querySelector('#modal-root');
  if (!root) return;

  // Returning users (login_count > 3) skip the full ~7s guide; keep compact preview only.
  let skipFullGuide = false;
  try {
    if (window.sb) {
      const { data: sess } = await window.sb.auth.getSession();
      const uid = sess?.session?.user?.id;
      if (uid) {
        const { data: prof } = await window.sb
          .from('profiles')
          .select('login_count')
          .eq('id', uid)
          .maybeSingle();
        skipFullGuide = Number(prof?.login_count) > 3;
      }
    }
  } catch (_) { }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal weight-modal' + (skipFullGuide ? ' weight-modal--weigh' : ' weight-modal--guide');
  const u = unit || '';
  const ppu = Number(pricePerUnit) || 0;
  const ppuDisplay = ppu ? `$${ppu.toFixed(2)}` : '';
  const unitLabel = u || 'unit';
  const productLabel = (name && String(name).trim()) ? String(name).trim() : 'item';
  const productSafe = productLabel.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // One full play of the weigh guide (~7s) before weight entry shows (skipped for login_count > 3)
  const GUIDE_MS = 7000;
  const guideVideoSrc = 'Images/weigh-guide.mp4?v=3';

  modal.innerHTML = `
    <div class="wm-guide${skipFullGuide ? ' wm-guide--compact' : ''}">
      <div class="wm-guide-frame">
        <video class="wm-guide-video" src="${guideVideoSrc}" autoplay muted playsinline loop preload="auto"></video>
      </div>
      <div class="wm-guide-caption">How to weigh your item</div>
      <div class="wm-guide-hint">Then place <strong>${productSafe}</strong> on the scale</div>
    </div>
    <div class="wm-weigh${skipFullGuide ? ' wm-weigh--in' : ''}"${skipFullGuide ? '' : ' hidden'}>
      <div class="modal-body" style="padding-top:4px;">
        <div class="modal-product">${productSafe}</div>
        <label class="modal-label">Weight${u ? ' (' + u + ')' : ''}</label>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#9ca3af;margin-bottom:8px;">
          <span class="wm-scale-dot" style="width:6px;height:6px;border-radius:50%;background:#d1d5db;display:inline-block;transition:background 0.3s;"></span>
          <span class="wm-scale-status">Connecting to scale…</span>
        </div>
        <div class="modal-input-row">
          <input type="number" class="modal-input" min="0" step="0.001" placeholder="0.000" inputmode="decimal">
          ${u ? `<span class="modal-input-unit">${u}</span>` : ''}
        </div>
        <div class="modal-estimate" style="display:none;">
          <span class="modal-estimate-label">Estimated Total:</span>
          <span class="modal-estimate-price">$0.00</span>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary">Cancel</button>
        <button class="btn btn-primary" disabled>Add to Cart</button>
      </div>
    </div>
    ${skipFullGuide ? '' : `<div class="wm-guide-actions">
      <button type="button" class="btn btn-secondary wm-guide-cancel">Cancel</button>
    </div>`}
  `;
  overlay.appendChild(modal);
  root.appendChild(overlay);

  const guideEl = modal.querySelector('.wm-guide');
  const weighEl = modal.querySelector('.wm-weigh');
  const guideActions = modal.querySelector('.wm-guide-actions');
  const videoEl = modal.querySelector('.wm-guide-video');
  const input = modal.querySelector('.modal-input');
  const btnCancel = modal.querySelector('.wm-weigh .btn-secondary');
  const btnGuideCancel = modal.querySelector('.wm-guide-cancel');
  const btnOk = modal.querySelector('.btn-primary');
  const estimateEl = modal.querySelector('.modal-estimate');
  const estimatePriceEl = modal.querySelector('.modal-estimate-price');
  const dotEl = modal.querySelector('.wm-scale-dot');
  const statusEl = modal.querySelector('.wm-scale-status');
  let scaleChannel = null;
  let dotTimer = null;
  let wakeTimer = null;
  let holdTimer = null;
  let tickTimer = null;
  let guideTimer = null;
  let autoConfirmed = false;
  let closed = false;
  let guideDone = !!skipFullGuide;
  let acceptLive = false;
  let lastKg = null;
  let stableSince = null;
  const MIN_KG = 0.01; // ignore noise / empty-cart negative offset
  const STABLE_DELTA_KG = 0.02; // ~0.7 oz — reset hold if the pan is still moving
  const STABLE_MS = 5000; // keep reading a few seconds after it settles
  const WAKE_MS = 1200; // skip stale DB weight + the scale_wanted realtime echo

  const setScaleWanted = (wanted) => {
    if (!window.sb || !CART_ID) return;
    const payload = wanted
      ? { scale_wanted: true, scale_wanted_at: new Date().toISOString() }
      : { scale_wanted: false };
    window.sb.from('carts').update(payload).eq('cart_id', CART_ID)
      .then(() => {})
      .catch(() => {});
  };

  const revealWeighUi = () => {
    if (guideDone || closed) return;
    guideDone = true;
    clearTimeout(guideTimer);
    modal.classList.remove('weight-modal--guide');
    modal.classList.add('weight-modal--weigh');
    if (guideActions) {
      guideActions.hidden = true;
      try { guideActions.remove(); } catch (_) {}
    }
    if (weighEl) {
      weighEl.hidden = false;
      // Restart fade in case the class was already applied
      weighEl.classList.remove('wm-weigh--in');
      void weighEl.offsetWidth;
      weighEl.classList.add('wm-weigh--in');
    }
    if (guideEl) guideEl.classList.add('wm-guide--compact');
    try { input.focus(); input.select?.(); } catch (_) {}
  };

  const close = () => {
    if (closed) return;
    closed = true;
    setScaleWanted(false);
    clearTimeout(dotTimer);
    clearTimeout(wakeTimer);
    clearTimeout(holdTimer);
    clearTimeout(guideTimer);
    if (tickTimer) clearInterval(tickTimer);
    try { if (videoEl) { videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load(); } } catch (_) {}
    if (scaleChannel && window.sb) {
      try { window.sb.removeChannel(scaleChannel); } catch (_) {}
    }
    try { root.removeChild(overlay); } catch (_) {}
  };

  // Live price calculation as user types or scale updates
  const updateEstimate = () => {
    const val = Number(input.value);
    if (val > 0 && ppu > 0) {
      const total = val * ppu;
      estimatePriceEl.textContent = `$${total.toFixed(2)}`;
      estimateEl.style.display = 'flex';
      btnOk.removeAttribute('disabled');
    } else if (val > 0) {
      estimateEl.style.display = 'none';
      btnOk.removeAttribute('disabled');
    } else {
      estimateEl.style.display = 'none';
      btnOk.setAttribute('disabled', 'true');
    }
  };

  const maybeAutoAdd = () => {
    if (!guideDone || autoConfirmed || !acceptLive || lastKg == null || lastKg <= MIN_KG || !stableSince) return;
    const held = Date.now() - stableSince;
    const w = Math.abs(Number(input.value)) || lastKg;
    if (held < STABLE_MS) {
      const leftSec = Math.max(1, Math.ceil((STABLE_MS - held) / 1000));
      if (statusEl) statusEl.textContent = `Live from scale \u00b7 hold still ${leftSec}s\u2026`;
      return;
    }
    autoConfirmed = true;
    input.value = w.toFixed(3);
    updateEstimate();
    if (statusEl) statusEl.textContent = `Adding ${w.toFixed(3)} ${u || 'kg'}\u2026`;
    holdTimer = setTimeout(() => { btnOk.click(); }, 700);
  };

  // Live kg from this cart's Pi. Hold still ~5s after it settles, then auto-add.
  const setScaleWeight = (kg) => {
    if (!acceptLive) return;
    const w = Math.abs(Number(kg));
    if (!Number.isFinite(w)) return;
    input.value = w.toFixed(3);
    updateEstimate();
    if (dotEl) {
      dotEl.style.background = '#22c55e';
      clearTimeout(dotTimer);
      dotTimer = setTimeout(() => { dotEl.style.background = '#d1d5db'; }, 3000);
    }
    if (autoConfirmed) return;

    if (w <= MIN_KG) {
      lastKg = w;
      stableSince = null;
      if (statusEl) statusEl.textContent = 'Place item on the scale\u2026';
      return;
    }

    if (lastKg == null || lastKg <= MIN_KG || Math.abs(w - lastKg) > STABLE_DELTA_KG) {
      lastKg = w;
      stableSince = Date.now();
    }
    maybeAutoAdd();
  };

  input.addEventListener('input', updateEstimate);
  btnCancel.addEventListener('click', close);
  if (btnGuideCancel) btnGuideCancel.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  btnOk.addEventListener('click', () => {
    const val = Number(input.value);
    if (!val || val <= 0) { input.focus(); return; }
    try { onConfirm && onConfirm(val); } finally { close(); }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); btnOk.click(); }
  });

  // --- Scale: this cart_id asks the Pi to wake, then says done on close ---
  // Wake during the guide so the scale is ready when weight UI appears.
  if (window.sb && CART_ID) {
    if (statusEl) statusEl.textContent = 'Starting scale \u2014 keep cart empty\u2026';
    setScaleWanted(true);
    wakeTimer = setTimeout(() => {
      acceptLive = true;
      if (!autoConfirmed && statusEl && Number(input.value) <= MIN_KG) {
        statusEl.textContent = 'Place item on the scale\u2026';
      }
    }, WAKE_MS);
    tickTimer = setInterval(maybeAutoAdd, 250);

    scaleChannel = window.sb.channel('wm-scale-live-' + CART_ID)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'carts',
        filter: 'cart_id=eq.' + CART_ID
      }, (payload) => {
        if (payload.new && payload.new.weight_kg != null) {
          setScaleWeight(payload.new.weight_kg);
        }
      })
      .subscribe();
  } else {
    if (statusEl) statusEl.textContent = CART_ID ? 'Scale not connected' : 'Missing cart id';
  }

  // Full guide for the first few visits; returning users (login_count > 3) get
  // compact preview + weight UI immediately.
  if (!skipFullGuide) {
    guideTimer = setTimeout(revealWeighUi, GUIDE_MS);
  } else {
    try { input.focus(); input.select?.(); } catch (_) {}
  }
  if (videoEl) {
    videoEl.addEventListener('error', () => {
      console.warn('Weigh guide video failed to load', guideVideoSrc);
    }, { once: true });
    videoEl.addEventListener('loadeddata', () => {
      try { videoEl.play().catch(() => {}); } catch (_) {}
    }, { once: true });
    try { videoEl.play().catch(() => {}); } catch (_) {}
  }
}

try { window.showWeightModal = showWeightModal; } catch (_) {}

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

  // Update: User specified explicit URL GET /products/{id}
  // We fetch these in parallel with limited concurrency to respect the new structure.

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

// 2. Function to get a single product by ID (User provided snippet adapted)
async function getProduct(id) {
  try {
    // Use existing API_BASE which is already set to the correct AWS URL
    const url = `${API_BASE}/products/${id}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error('Product not found or error:', response.status);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error('Network error:', error);
    return null;
  }
}

// Look up a product by its physical barcode number (uses ?barcode= query parameter)
async function getProductByBarcode(barcode) {
  try {
    const data = await apiFetch(`/products?barcode=${encodeURIComponent(barcode)}`);
    const items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
    if (!items.length) return null;
    // Guard against API fuzzy-match or cached results returning the wrong product:
    // verify the returned item's barcode (or id) actually equals the scanned value.
    const barcodeStr = String(barcode);
    const match = items.find(item => {
      const val = item.barcode ?? item.id;
      return val != null && String(val) === barcodeStr;
    });
    return match ?? null;
  } catch (error) {
    console.error('Barcode lookup error:', error);
    return null;
  }
}

// 3. Example: How to use it to update your page (User provided snippet)
async function showProductOnPage(productId) {
  const product = await getProduct(productId);

  if (product) {
    const nameEl = document.getElementById('product-name');
    if (nameEl) nameEl.innerText = product.name || '';

    const priceEl = document.getElementById('product-price');
    // Format price if numeric
    const p = product.price;
    if (priceEl) priceEl.innerText = (typeof p === 'number') ? `$${p.toFixed(2)}` : (p || '');

    const descEl = document.getElementById('product-desc');
    if (descEl) descEl.innerText = product.description || '';

    // Show allergy info if it exists
    const allergyEl = document.getElementById('allergy-info');
    if (allergyEl) {
      if (product.allergySummary && product.allergySummary !== 'none') {
        allergyEl.innerText = `⚠️ Allergy Warning: ${product.allergySummary}`;
        allergyEl.style.display = 'block';
      } else {
        allergyEl.style.display = 'none';
      }
    }

    // Show Image (using the first image key if available)
    const imgEl = document.getElementById('product-img');
    if (imgEl && product.imageKeys && product.imageKeys.length > 0) {
      // Use existing helper to get signed URL if possible
      try {
        // getImageUrlForKey is defined right above in site.js
        const url = await getImageUrlForKey(product.imageKeys[0]);
        if (url) imgEl.src = url;
      } catch (e) {
        console.warn('Failed to load image url', e);
      }
    }
  }
}
// Expose for debugging/console use
window.showProductOnPage = showProductOnPage;

// ---- Supabase Receipt & Checkout History ----
// Fetch all receipts for the current user
async function fetchUserReceipts({ limit = 50, offset = 0 } = {}) {
  try {
    if (!window.sb) return [];
    const { data, error } = await window.sb
      .from('receipts')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('Failed to fetch user receipts', e);
    return [];
  }
}

// Fetch checkout items for a specific receipt
async function fetchCheckoutItemsForReceipt(receiptId) {
  try {
    if (!window.sb) return [];
    const { data, error } = await window.sb
      .from('checkout_items')
      .select('*')
      .eq('receipt_id', receiptId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('Failed to fetch checkout items for receipt', receiptId, e);
    return [];
  }
}

// Fetch all checkout items for the current user (latest first)
async function fetchUserCheckoutHistory({ limit = 100, offset = 0 } = {}) {
  try {
    if (!window.sb) return [];
    const { data, error } = await window.sb
      .from('checkout_items')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('Failed to fetch user checkout history', e);
    return [];
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
  // Allergy info
  const allergyVal = (p.allergySummary && p.allergySummary !== 'none') ? p.allergySummary : 'none';
  const allergyAttr = ` data-allergy="${String(allergyVal).replace(/"/g, '&quot;')}"`;

  // We'll set data-image dynamically after resolving, but if p.image_url is a direct link we could set it here.
  // For now rely on renderProductsToGrid to set it.
  return `
      <div class="product-card"${idAttr}${nameAttr}${priceAttr}${areaAttr}${unitAttr}${scaleAttr}${allergyAttr}>
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

  // Trigger fade-in for category page
  if (document.body.classList.contains('category-page')) {
    // Small delay to ensure DOM paint happens with opacity:0 first
    setTimeout(() => {
      const cards = gridEl.querySelectorAll('.product-card');
      cards.forEach(card => card.classList.add('visible'));
    }, 100);
  }

  // Bind add-to-cart interactions for this grid
  try { bindGridForCart(gridEl); } catch (_) { }

  // Resolve images asynchronously
  const cards = Array.from(gridEl.querySelectorAll('.product-card'));
  const resolvedImages = new Map(); // key (id/name) -> url
  const resolvedKeys = new Map();   // key (id/name) -> imageKey (backend path)

  await Promise.all(cards.map(async (card, idx) => {
    const p = items[idx];
    const key = Array.isArray(p.imageKeys) && p.imageKeys.length ? p.imageKeys[0] : null;
    let url = null;
    let finalImageKey = null;

    // Prefer existing API image resolver when key is provided
    if (key) {
      url = await getImageUrlForKey(key);
      finalImageKey = key;
    } else if (p.image_url) {
      // image_url may be a full URL OR an external key that the API can sign
      if (/^https?:\/\//i.test(p.image_url)) {
        url = p.image_url;
        // Don't treat public URLs as refreshable keys unless needed, but we can store them
      } else {
        try { url = await getImageUrlForKey(p.image_url); } catch { }
        finalImageKey = p.image_url;
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
            finalImageKey = p.image_url;
          }
        } catch { }
      }
      if (url) {
        imgDiv.style.backgroundImage = `url('${url}')`;
        imgDiv.style.backgroundSize = 'cover';
        imgDiv.style.backgroundPosition = 'center';
        // Save url to card for add-to-cart
        card.setAttribute('data-image', url);
        // Save the key/path for refreshing later
        if (finalImageKey) {
          card.setAttribute('data-image-key', finalImageKey);
        }

        // Track for cart update
        if (p.id) {
          resolvedImages.set(String(p.id), url);
          if (finalImageKey) resolvedKeys.set(String(p.id), finalImageKey);
        }
        if (p.name) {
          resolvedImages.set(`name:${p.name}`, url);
          if (finalImageKey) resolvedKeys.set(`name:${p.name}`, finalImageKey);
        }
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

  // Self-heal: Update cart items if we found images OR keys for them
  if (resolvedImages.size > 0 || resolvedKeys.size > 0) {
    const cartItems = loadCart();
    let dirty = false;
    cartItems.forEach(it => {
      const idKey = it.id != null ? String(it.id) : null;
      const nameKey = it.name ? `name:${it.name}` : null;

      // 1. Backfill Image URL if missing
      if (!it.image) {
        let foundUrl = null;
        if (idKey && resolvedImages.has(idKey)) foundUrl = resolvedImages.get(idKey);
        else if (nameKey && resolvedImages.has(nameKey)) foundUrl = resolvedImages.get(nameKey);

        if (foundUrl) {
          it.image = foundUrl;
          dirty = true;
        }
      }

      // 2. Backfill Image Key if missing (crucial for refreshing expired URLs)
      if (!it.imageKey) {
        let foundKey = null;
        if (idKey && resolvedKeys.has(idKey)) foundKey = resolvedKeys.get(idKey);
        else if (nameKey && resolvedKeys.has(nameKey)) foundKey = resolvedKeys.get(nameKey);

        if (foundKey) {
          it.imageKey = foundKey;
          dirty = true;
        }
      }
    });
    if (dirty) {
      saveCart(cartItems);
      renderCart();
    }
  }
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

// Heartbeat: upsert session row with latest subtotal and last_seen.
// Do NOT touch force_sign_out here — admin / expire_stale_kiosk_sessions set it,
// and clearing it on every beat would race those force-outs away.
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

    // If the backend already flagged this device, sign out instead of heartbeating.
    try {
      const { data: row } = await window.sb
        .from('active_sessions')
        .select('force_sign_out, session_started_at')
        .eq('user_id', user.id)
        .eq('device_id', deviceId)
        .maybeSingle();
      if (row?.force_sign_out) {
        try { await clearActiveSession(); } catch (_) { }
        try { localStorage.removeItem(CART_KEY); } catch (_) { }
        try { sessionStorage.clear(); } catch (_) { }
        try { await window.sb.auth.signOut({ scope: 'local' }); } catch (_) { }
        if (!location.pathname.includes('signin.html')) {
          window.location.href = withCart('signin.html');
        }
        return;
      }
    } catch (_) { }

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

/** Mark this device session inactive so the mobile app drops Active within ~5s */
async function clearActiveSession() {
  try {
    if (!window.sb) return;
    const { data } = await window.sb.auth.getSession();
    const user = data?.session?.user;
    if (!user) return;
    const deviceId = getDeviceId();
    await window.sb
      .from('active_sessions')
      .update({
        force_sign_out: false,
        last_seen: new Date(Date.now() - 60_000).toISOString(),
        subtotal: 0,
      })
      .eq('user_id', user.id)
      .eq('device_id', deviceId);
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
            // Age out session for the mobile app, then sign out locally
            try { await clearActiveSession(); } catch (_) { }
            try { localStorage.removeItem(CART_KEY); } catch (_) { }
            try { sessionStorage.clear(); } catch (_) { }
            try { await window.sb.auth.signOut({ scope: 'local' }); } catch (_) { }
            // Redirect to sign-in if not already there
            if (!location.pathname.includes('signin.html')) {
              window.location.href = withCart('signin.html');
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

// --- Cart Selection Logic ---
let selectedItemKey = null;

function selectCartItem(key) {
  selectedItemKey = key;
  const items = loadCart();
  const item = items.find(it => ((it.id != null) ? String(it.id) : `name:${it.name}`) === key);

  // 1. Update Cart UI Selection State
  const container = document.querySelector('.cart-items');
  if (container) {
    const allItems = container.querySelectorAll('.cart-item');
    allItems.forEach(el => {
      if (el.dataset.key === key) el.classList.add('selected');
      else el.classList.remove('selected');
    });
  }

  // 2. Update Left Panel Display (if in OpenSearch mode)
  const displayEl = document.getElementById('selected-item-display');
  if (displayEl) {
    if (item && item.image) {
      displayEl.innerHTML = `<img src="${item.image}" class="selected-item-image" alt="${item.name}" draggable="false">`;
    } else if (item) {
      // Item selected but no image
      displayEl.innerHTML = `<div class="placeholder-message">${item.name}</div>`;
    } else {
      // Nothing selected
      displayEl.innerHTML = `<div class="placeholder-message">"Selected" item Image "shown here"</div>`;
    }
  }
}

function renderCart() {
  // Support both Receipt/Cabinet (right-section) and Checkout (checkout-right)
  const container = document.querySelector('.right-section .cart-items, .checkout-right .cart-items');
  const subtotalEl = document.querySelector('.right-section .subtotal-amount, .checkout-right .subtotal-amount');
  if (!container) return;
  const items = loadCart();
  container.innerHTML = '';
  let subtotal = 0;

  // If previously selected item is gone, clear selection
  if (selectedItemKey) {
    const exists = items.some(it => ((it.id != null) ? String(it.id) : `name:${it.name}`) === selectedItemKey);
    if (!exists) selectedItemKey = null;
  }

  // If nothing selected and we have items, select the last one (most recently added)
  if (!selectedItemKey && items.length > 0) {
    const last = items[items.length - 1];
    selectedItemKey = (last.id != null) ? String(last.id) : `name:${last.name}`;
    // Defer the UI update slightly to ensure DOM is ready if called from init
    setTimeout(() => selectCartItem(selectedItemKey), 0);
  } else if (items.length === 0) {
    // Empty cart, reset display
    selectCartItem(null);
  }

  items.forEach((it, idx) => {
    const line = (Number(it.price) || 0) * (Number(it.qty) || 1);
    subtotal += line;

    if (container) {
      const div = document.createElement('div');
      div.className = 'cart-item';
      const key = (it.id != null) ? String(it.id) : `name:${it.name}`;
      div.setAttribute('data-key', key);

      // Apply selection class
      if (key === selectedItemKey) div.classList.add('selected');

      const qty = Number(it.qty) || 1;
      let labelText = (it.name || 'item');
      if (it.weighted) {
        const shown = qty % 1 === 0 ? qty.toString() : qty.toFixed(3).replace(/\.0+$/, '');
        const u = it.unit ? ` ${it.unit}` : '';
        labelText = `${labelText} ${shown}${u}`;
      } else if (qty > 1) {
        labelText = `${labelText} x${qty}`;
      }

      let imgHtml = '';
      if (it.image) {
        imgHtml = `<div class="item-image" style="background-image: url('${it.image}');"></div>`;
      }

      div.innerHTML = `
          <div class="item-left">
            <div class="item-number">${idx + 1}</div>
            ${imgHtml}
            <div class="item-label">${labelText}</div>
          </div>
          <div class="item-right">
            <div class="item-price">${formatMoney(line)}</div>
            <button class="remove-item" title="Remove" aria-label="Remove item" data-key="${key}">✕</button>
          </div>
        `;

      // Click to select
      div.addEventListener('click', (e) => {
        // Don't select if clicking remove button
        if (e.target.closest('.remove-item')) return;
        selectCartItem(key);
      });

      container.appendChild(div);
    }
  });
  if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal);
  // Push a heartbeat with latest subtotal (debounced)
  try { scheduleHeartbeat(subtotal); } catch (_) { }

  if (selectedItemKey) selectCartItem(selectedItemKey);

  // Disable checkout button if cart is empty OR user is not signed in
  const checkoutBtn = document.querySelector('.checkout-btn');
  if (checkoutBtn) {
    if (items.length === 0) {
      checkoutBtn.setAttribute('disabled', 'true');
      checkoutBtn.style.opacity = '0.5';
      checkoutBtn.style.pointerEvents = 'none';
      checkoutBtn.style.cursor = 'not-allowed';
      checkoutBtn.title = '';
    } else {
      // Check auth state and disable if not signed in
      (async () => {
        try {
          let isSignedIn = false;
          if (window.sb) {
            const { data } = await window.sb.auth.getSession();
            isSignedIn = !!(data && data.session && data.session.user);
          }
          if (!isSignedIn) {
            checkoutBtn.setAttribute('disabled', 'true');
            checkoutBtn.style.opacity = '0.5';
            checkoutBtn.style.cursor = 'not-allowed';
            checkoutBtn.style.pointerEvents = 'auto'; // keep clickable so tap shows toast
            checkoutBtn.title = 'Sign in to checkout';
          } else {
            checkoutBtn.removeAttribute('disabled');
            checkoutBtn.style.opacity = '1';
            checkoutBtn.style.pointerEvents = 'auto';
            checkoutBtn.style.cursor = 'pointer';
            checkoutBtn.title = '';
          }
        } catch (_) {
          // On error, allow checkout (don't block)
          checkoutBtn.removeAttribute('disabled');
          checkoutBtn.style.opacity = '1';
          checkoutBtn.style.pointerEvents = 'auto';
          checkoutBtn.style.cursor = 'pointer';
        }
      })();
    }
  }
}

function removeFromCartByKey(key) {
  if (!key) return;
  const items = loadCart();
  const next = items.filter(it => ((it.id != null) ? String(it.id) : `name:${it.name}`) !== key);
  saveCart(next);

  // If we removed the selected item, renderCart will handle clearing/reselecting
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
    // Keep selection on this item
    selectCartItem(key);
    return 'decremented';
  }
  return null;
}

function addToCart({ id, name, price, qty = 1, weighted = false, unit = null, unitPrice = null, image = null, imageKey = null }) {
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
    // Update image if available
    if (image) existing.image = image;
    if (imageKey) existing.imageKey = imageKey;
  } else {
    if (weighted) {
      items.push({ id, name, price: Number(unitPrice != null ? unitPrice : price) || 0, qty: Number(qty) || 0, weighted: true, unit: unit || null, image, imageKey });
    } else {
      items.push({ id, name, price: Number(price) || 0, qty: 1, image, imageKey });
    }
  }
  saveCart(items);

  // Auto-select the newly added/updated item
  selectedItemKey = key;
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
    const image = card.getAttribute('data-image'); // Get image URL
    const imageKey = card.getAttribute('data-image-key'); // Get image Key for refreshing

    let price = priceAttr != null ? Number(priceAttr) : null;
    if (price == null || Number.isNaN(price)) {
      // Parse from visible price text like "$2.00"
      const priceText = (card.querySelector('.product-price')?.textContent || '').replace(/[^0-9.\-]/g, '');
      price = Number(priceText) || 0;
    }
    const needsScale = card.getAttribute('data-scale') === '1';
    const unit = card.getAttribute('data-unit');
    const allergy = card.getAttribute('data-allergy');

    const proceed = () => {
      if (needsScale) {
        showWeightModal({
          name, unit, pricePerUnit: price, onConfirm: (weightVal) => {
            const w = Number(weightVal);
            if (!w || w <= 0) return; // ignore invalid
            addToCart({ id, name, price, qty: w, weighted: true, unit, unitPrice: price, image, imageKey });
          }
        });
      } else {
        addToCart({ id, name, price, image, imageKey });
      }
    };

    const showAllergy = localStorage.getItem('nc_show_allergy_info') !== 'false';
    if (showAllergy && allergy && allergy.toLowerCase() !== 'none') {
      showAllergyModal({
        name,
        allergyText: allergy,
        onConfirm: proceed
      });
    } else {
      proceed();
    }
  });
}

// Kiosk: don't let images be dragged into a new window/tab
document.addEventListener('dragstart', (e) => {
  if (e.target && e.target.tagName === 'IMG') e.preventDefault();
}, true);

// Page Transition Fade-In Logic
document.addEventListener('DOMContentLoaded', () => {
  if (document.body.classList.contains('page-opacity-0')) {
    // slight delay to ensure CSS transition can catch the change
    setTimeout(() => {
      document.body.classList.add('page-fade-in');
    }, 50);
  }
});

// Append ?cart= param to any URL so it survives every navigation
function withCart(url) {
  if (!CART_ID) return url;
  const sep = url.includes('?') ? '&' : '?';
  // Don't double-add if already present
  if (url.includes('cart=')) return url;
  return url + sep + 'cart=' + encodeURIComponent(CART_ID);
}

// Smooth navigation helper
window.smoothNavigate = function (url) {
  document.body.classList.add('page-fade-out');
  setTimeout(() => {
    window.location.href = withCart(url);
  }, 300);
};

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
    // Periodic heartbeat (~2s) so the mobile app can detect Active / signed-out within ~5s
    try {
      setInterval(() => {
        try { upsertActiveSession(getCartSubtotal()); } catch (_) { }
      }, 2000);
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

  // --- USB Barcode Scanner Support (non-admin pages only) ---
  if (!isAdminPath) {
    let scanBuffer = '';
    let scanTimeout = null;
    let scanProcessing = false;
    const SCAN_CHAR_TIMEOUT = 80; // max ms between chars for scanner input

    document.addEventListener('keydown', (e) => {
      // Skip if user is typing in an input, textarea, or contenteditable
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
      // Skip if a modal is currently open
      if (document.querySelector('.modal-overlay')) return;
      // Skip if already processing a scan
      if (scanProcessing) return;

      if (e.key === 'Enter' && scanBuffer.length >= 3) {
        e.preventDefault();
        const barcode = scanBuffer;
        scanBuffer = '';
        if (scanTimeout) { clearTimeout(scanTimeout); scanTimeout = null; }
        handleBarcodeScan(barcode);
      } else if (/^[0-9]$/.test(e.key)) {
        scanBuffer += e.key;
        // Reset timeout — if no next char within SCAN_CHAR_TIMEOUT, clear buffer
        if (scanTimeout) clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => { scanBuffer = ''; }, SCAN_CHAR_TIMEOUT);
      } else {
        // Non-numeric key breaks the scan sequence
        scanBuffer = '';
        if (scanTimeout) { clearTimeout(scanTimeout); scanTimeout = null; }
      }
    });

    async function handleBarcodeScan(barcode) {
      scanProcessing = true;
      try { showHintToast(`Scanning: ${barcode}…`); } catch (_) { }
      try {
        const product = await getProductByBarcode(barcode);
        if (!product) {
          try { showHintToast(`Item not found: ${barcode}`); } catch (_) { }
          scanProcessing = false;
          return;
        }

        const id = product.id || barcode;
        const name = product.name || '';
        const price = Number(product.price) || 0;
        const unit = product.priceUnit || null;
        const needsScale = !!product.scaleNeed;
        const allergyVal = (product.allergySummary && product.allergySummary !== 'none') ? product.allergySummary : null;

        // Resolve image if available
        let image = null;
        let imageKey = null;
        if (Array.isArray(product.imageKeys) && product.imageKeys.length) {
          imageKey = product.imageKeys[0];
          try { image = await getImageUrlForKey(imageKey); } catch (_) { }
        } else if (product.image_url) {
          if (/^https?:\/\//i.test(product.image_url)) {
            image = product.image_url;
          } else {
            imageKey = product.image_url;
            try { image = await getImageUrlForKey(product.image_url); } catch (_) { }
          }
        }

        // Same flow as manual tap: allergy check → scale check → add
        const proceed = () => {
          if (needsScale) {
            showWeightModal({
              name, unit, pricePerUnit: price, onConfirm: (weightVal) => {
                const w = Number(weightVal);
                if (!w || w <= 0) return;
                addToCart({ id, name, price, qty: w, weighted: true, unit, unitPrice: price, image, imageKey });
                try { showHintToast(`Added ${name}`); } catch (_) { }
              }
            });
          } else {
            addToCart({ id, name, price, image, imageKey });
            try { showHintToast(`Added ${name}`); } catch (_) { }
          }
        };

        const showAllergy = localStorage.getItem('nc_show_allergy_info') !== 'false';
        if (showAllergy && allergyVal) {
          showAllergyModal({ name, allergyText: allergyVal, onConfirm: proceed });
        } else {
          proceed();
        }
      } catch (err) {
        console.error('[Barcode] Error processing scan:', err);
        try { showHintToast('Scan error — try again'); } catch (_) { }
      }
      scanProcessing = false;
    }
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

      // Signed-in: warn after 5 min with no input, then log out if still idle.
      // Guest: shorter idle loop back to the attract screen (unchanged).
      const AUTH_IDLE_MS = 5 * 60 * 1000;
      const AUTH_GRACE_MS = 60 * 1000;
      const GUEST_IDLE_MS = 3 * 60 * 1000;

      const clearPresence = () => {
        if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
        if (presenceHandle && typeof presenceHandle.close === 'function') {
          try { presenceHandle.close(); } catch (_) { }
        }
        presenceHandle = null;
        presenceShown = false;
      };

      const signOutForInactivity = async () => {
        try { await clearActiveSession(); } catch (_) { }
        try { localStorage.removeItem('nc_cart_v1'); } catch (_) { }
        try { sessionStorage.clear(); } catch (_) { }
        if (window.sb) {
          try { await window.sb.auth.signOut({ scope: 'local' }); } catch (_) { }
        }
        window.location.href = withCart('signin.html');
      };

      const handleIdleTimeout = () => {
        if (isUserSignedIn) {
          presenceShown = true;
          const graceSec = Math.round(AUTH_GRACE_MS / 1000);
          presenceHandle = showPresenceModal({
            message: 'No activity for 5 minutes. Tap below to stay signed in, or you will be signed out.',
            buttonText: "I'm still here",
            countdownSec: graceSec,
            onConfirm: () => {
              clearPresence();
              resetIdleTimer();
            },
          });

          if (!presenceHandle) {
            const confirmed = window.confirm('No activity for 5 minutes. Stay signed in?');
            if (confirmed) {
              clearPresence();
              resetIdleTimer();
            } else {
              signOutForInactivity();
            }
            return;
          }

          graceTimer = setTimeout(() => {
            if (!presenceShown) return;
            clearPresence();
            signOutForInactivity();
          }, AUTH_GRACE_MS);

        } else {
          // Guest: back to the idle attract loop (no prompt)
          window.location.href = withCart('image.html');
        }
      };

      const resetIdleTimer = () => {
        clearPresence();
        if (idleTimer) clearTimeout(idleTimer);
        const timeout = isUserSignedIn ? AUTH_IDLE_MS : GUEST_IDLE_MS;
        idleTimer = setTimeout(handleIdleTimeout, timeout);
      };

      // Any real input resets the idle clock. While the warning is up, ignore
      // mouse-move / scroll / focus noise so the modal does not vanish by itself.
      const onActivity = (e) => {
        if (presenceShown && (e.type === 'mousemove' || e.type === 'scroll' || e.type === 'focus')) {
          return;
        }
        resetIdleTimer();
      };

      const initMonitor = async () => {
        // Check auth status
        // Check auth status & subscribe to changes
        if (window.sb) {
          try {
            const { data } = await window.sb.auth.getSession();
            isUserSignedIn = !!(data && data.session);
          } catch (_) {
            isUserSignedIn = false;
          }

          // Listen for dynamic auth changes (e.g. late hydration)
          window.sb.auth.onAuthStateChange((event, session) => {
            // Delink this cart from the user on sign-out
            if (event === 'SIGNED_OUT' && CART_ID && window.sb) {
              try { window.sb.from('carts').update({ user_id: null }).eq('cart_id', CART_ID).then(() => {}).catch(() => {}); } catch (_) {}
            }

            const wasSignedIn = isUserSignedIn;

            // Check if we are on an auth page
            const isAuthPage = location.pathname.includes('signin.html') || location.pathname.includes('create-account.html');

            if (isAuthPage) {
              // Always treat as guest on signin pages to ensure idle loop works (3 mins)
              isUserSignedIn = false;
            } else {
              // Normal behavior
              isUserSignedIn = !!session;

              // Sync user preferences if signed in
              if (isUserSignedIn && window.sb) {
                window.sb.from('profiles')
                  .select('show_allergy_caution')
                  .eq('id', session.user.id)
                  .single()
                  .then(({ data }) => {
                    if (data) {
                      const val = data.show_allergy_caution !== false;
                      localStorage.setItem('nc_show_allergy_info', val ? 'true' : 'false');
                    }
                  })
                  .catch(() => { }); // silent fail
              }
            }

            // If state actually changed, reset timer immediately to apply new policy
            if (wasSignedIn !== isUserSignedIn) {
              console.debug('Inactivity monitor: Auth state changed to', isUserSignedIn ? 'signed-in' : 'guest');
              resetIdleTimer();
            }
          });
        }

        // Force "not signed in" state on auth pages to ensure 3-minute idle loop
        // prevents race conditions where session tracking might lag during sign-out
        const isAuthPage = location.pathname.includes('signin.html') || location.pathname.includes('create-account.html');
        if (isAuthPage) {
          isUserSignedIn = false;
        } else if (window.sb) {
          // Initial sync on load (if not auth page)
          window.sb.auth.getSession().then(({ data }) => {
            if (data?.session?.user) {
              window.sb.from('profiles')
                .select('show_allergy_caution')
                .eq('id', data.session.user.id)
                .single()
                .then(({ data: prof }) => {
                  if (prof) {
                    const val = prof.show_allergy_caution !== false;
                    localStorage.setItem('nc_show_allergy_info', val ? 'true' : 'false');
                  }
                })
                .catch(() => { });
            }
          });
        }

        const activityEvents = ['click', 'mousemove', 'keydown', 'touchstart', 'scroll', 'focus'];
        activityEvents.forEach(ev => window.addEventListener(ev, onActivity, { passive: true, capture: true }));

        resetIdleTimer();
      };

      initMonitor();
    }
  } catch (_) { }

  // Add click functionality to checkout button
  const checkoutBtn = document.querySelector('.checkout-btn');
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', async function (e) {
      const items = loadCart();
      if (items.length === 0) {
        e.preventDefault();
        try { showHintToast('Your cart is empty'); } catch (_) { }
        return;
      }

      // Check if user is signed in before allowing checkout
      try {
        let isSignedIn = false;
        if (window.sb) {
          const { data } = await window.sb.auth.getSession();
          isSignedIn = !!(data && data.session && data.session.user);
        }
        if (!isSignedIn) {
          e.preventDefault();
          try { showHintToast('Please sign in to checkout'); } catch (_) { }
          return;
        }
      } catch (_) { }

      const onCheckoutPage = location.pathname.includes('checkout.html');
      // Redirect into dedicated checkout page if not already there
      if (!onCheckoutPage) {
        // Transition animation: Fade out
        document.body.classList.add('page-transition-fade-out');
        setTimeout(() => {
          window.location.href = 'checkout.html';
        }, 500);
        return;
      }
      // On checkout page: refresh QR flow if available, else fallback to direct hosted redirect
      try {
        if (typeof window.__refreshQrCheckout === 'function') {
          await window.__refreshQrCheckout();
        } else {
          await startCheckout();
        }
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
    const TAP_WINDOW_MS = 3000;
    cards.forEach(card => {
      const titleEl = card.querySelector('.category-title');
      const title = titleEl ? titleEl.textContent.trim() : '';
      let lastTapAt = 0;

      // Two taps within 3s on the same card opens it (kiosk-friendly vs native dblclick)
      card.addEventListener('click', () => {
        if (navigating) return;
        const now = Date.now();
        if (lastTapAt && (now - lastTapAt) <= TAP_WINDOW_MS) {
          navigating = true;
          lastTapAt = 0;

          // Trigger fade out on the grid container
          const gridView = document.getElementById('view-category-grid');
          if (gridView) {
            gridView.classList.add('fade-out-active');
          }

          const q = title ? ('?name=' + encodeURIComponent(title)) : '';
          if (title) { try { sessionStorage.setItem('lastCategoryName', title); } catch { } }
          try { sessionStorage.setItem('lastView', 'category'); } catch { }

          setTimeout(() => {
            window.location.href = withCart('category.html' + q);
          }, 300);
          return;
        }

        lastTapAt = now;
        showHintToast('Tap twice to open');
      });
    });
  } else {
    // Non-index pages
    const isCabinetPage = /(^|\/)cabinet\.html(\?|$)/.test(location.pathname) || document.title === 'Cabinet';
    const isCategoryPage = /(^|\/)category\.html(\?|$)/.test(location.pathname);

    // Category page only: set title from query parameter.
    // This used to run on every non-cabinet page, which overwrote the title on
    // index/signin/create-account and replaced account.html's first heading with
    // "Category".
    if (isCategoryPage) {
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
          window.smoothNavigate('index.html?view=grid');
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
        // Make sure Loading placeholder is visible immediately
        grid.innerHTML = '<div class="product-card visible"><div class="product-info"><div class="product-image"></div><div class="product-name">Loading...</div></div></div>';
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
          document.body.classList.add('page-transition-fade-out');
          setTimeout(() => { window.location.href = withCart(dest); }, 500);
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
  const { embedded = false, returnSession = false } = options;
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

  if (embedded || returnSession) {
    return resp;
  }

  const url = resp?.url;
  if (url) {
    // Redirect to Stripe Checkout
    window.location.href = url;
    return;
  }
  // If no URL, but session returned, we could use Stripe.js redirect (not included). For now, error.
  throw new Error('No checkout URL returned');
}

// Checkout Page wiring (QR flow)
document.addEventListener('DOMContentLoaded', async () => {
  const isCheckout = /(^|\/)checkout\.html(\?|$)/.test(location.pathname) || document.body.classList.contains('checkout');
  if (!isCheckout) return;

  // Render the cart summary immediately
  renderCart();

  const mountEl = document.getElementById('checkout-mount');
  if (!mountEl) return;

  const statusEl = document.createElement('div');
  statusEl.className = 'qr-status';
  const linkEl = document.createElement('a');
  linkEl.className = 'qr-link';
  linkEl.target = '_blank';
  linkEl.rel = 'noreferrer noopener';

  let lastSessionId = null;
  let pollTimer = null;

  function setStatus(msg, kind = 'info') {
    statusEl.textContent = msg || '';
    statusEl.setAttribute('data-kind', kind);
  }

  async function renderQrForUrl(url, opts = {}) {
    if (!url) throw new Error('No checkout URL');
    mountEl.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'qr-box';

    const title = document.createElement('div');
    title.className = 'qr-title';
    title.textContent = 'Scan to pay';

    const qrHolder = document.createElement('div');
    qrHolder.className = 'qr-holder';

    const img = document.createElement('img');
    img.alt = 'QR code';
    img.className = 'qr-canvas';
    img.draggable = false;
    const size = opts.width || 340;
    img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=' + size + 'x' + size + '&data=' + encodeURIComponent(url);
    qrHolder.appendChild(img);

    wrapper.appendChild(title);
    wrapper.appendChild(qrHolder);
    wrapper.appendChild(statusEl);
    mountEl.appendChild(wrapper);

    linkEl.href = url;
    linkEl.textContent = 'Open checkout in browser';

    const payMeta = document.getElementById('checkout-pay-meta');
    if (payMeta) {
      payMeta.innerHTML = '';
      const meta = document.createElement('div');
      meta.className = 'qr-meta';
      meta.textContent = 'Cart is locked to this secure Stripe checkout link.';
      payMeta.appendChild(meta);
      payMeta.appendChild(linkEl);
    }

    setStatus('Ready to scan', 'success');
  }

  async function pollStatus(sessionId) {
    if (!sessionId) {
      setStatus('No session id to poll. Regenerate QR.', 'error');
      return;
    }
    if (!window.sb?.functions?.invoke) {
      // Avoid hammering an API that may not support status lookups
      setStatus('Awaiting payment. If stuck, refresh QR.', 'info');
      return;
    }
    // Clear previous poll if any
    if (pollTimer) clearInterval(pollTimer);

    let consecutiveErrors = 0;
    const check = async () => {
      try {
        let data = null;
        const { data: d, error } = await window.sb.functions.invoke('stripe-create-session', {
          body: { action: 'status', session_id: sessionId }
        });
        if (error) throw error;
        data = d;
        const status = data?.status || data?.payment_status;
        if (!status) return;

        if (status === 'complete' || status === 'paid') {
          setStatus('Payment complete. Finalizing...', 'success');
          clearInterval(pollTimer);
          pollTimer = null;
          // Clear cart and sign out
          try { localStorage.removeItem(CART_KEY); } catch (_) { }
          try { sessionStorage.clear(); } catch (_) { }
          try { renderCart(); } catch (_) { }
          try { showHintToast && showHintToast('Payment complete!'); } catch (_) { }
          try { window.sb?.auth?.signOut?.({ scope: 'local' }); } catch (_) { }
          setTimeout(() => {
            mountEl.innerHTML = '<div class="qr-box"><div class="qr-title">Thank you!</div><div class="qr-meta">Payment received. You will be redirected.</div></div>';
            window.location.href = withCart('signin.html');
          }, 800);
        } else if (status === 'expired' || status === 'canceled') {
          clearInterval(pollTimer);
          pollTimer = null;
          setStatus('Session expired. Please generate a new QR.', 'error');
        }
      } catch (e) {
        console.warn('Status poll failed', e);
        consecutiveErrors += 1;
        if (consecutiveErrors >= 3) {
          clearInterval(pollTimer);
          pollTimer = null;
          setStatus('Live status unavailable. Please refresh QR or check payment.', 'error');
        }
      }
    };

    // Kick off immediately and then interval
    await check();
    pollTimer = setInterval(check, 3500);
  }

  let checkoutChannel = null;

  async function runQrCheckout({ refresh = false } = {}) {
    try {
      setStatus(refresh ? 'Refreshing checkout link...' : 'Generating checkout link...', 'info');
      mountEl.classList.add('loading');

      // Cleanup previous realtime channel if exists
      if (checkoutChannel) {
        try { window.sb.removeChannel(checkoutChannel); } catch (_) { }
        checkoutChannel = null;
      }

      const session = await startCheckout({ returnSession: true });
      lastSessionId = session?.id || session?.session_id || null;
      const sessionUrl = session?.url;

      if (!lastSessionId) throw new Error('Stripe did not return a session ID');
      if (!sessionUrl) throw new Error('Stripe did not return a session URL');

      // Generate ephemeral short code for Realtime handshake (no DB required)
      const shortCode = Math.random().toString(36).substring(2, 10);

      // Setup Realtime responder
      if (window.sb) {
        checkoutChannel = window.sb.channel(`checkout_handshake_${shortCode}`, { config: { broadcast: { ack: true } } });
        checkoutChannel
          .on('broadcast', { event: 'request_url' }, () => {
            // Phone asked for URL, send it back
            checkoutChannel.send({ type: 'broadcast', event: 'response_url', payload: { url: sessionUrl } });
          })
          .subscribe();
      }

      // Use intermediary pay.html with the ephemeral code
      const origin = window.location.origin;
      const cleanOrigin = origin.replace(/\/$/, '');
      const qrUrl = `${cleanOrigin}/p.html?c=${shortCode}`;

      await renderQrForUrl(qrUrl, { width: 340 });
      pollStatus(lastSessionId);
    } catch (e) {
      console.error('QR checkout failed', e);
      mountEl.innerHTML = `<div style="color:#b91c1c; text-align:center;">Failed to create checkout: ${e?.message || e}</div>`;
    } finally {
      mountEl.classList.remove('loading');
    }
  }

  // Expose refresh for the global checkout button listener
  window.__refreshQrCheckout = () => runQrCheckout({ refresh: true });

  // Auto-refresh QR if cart changes in another tab
  window.addEventListener('storage', (e) => {
    if (e.key === CART_KEY) {
      runQrCheckout({ refresh: true });
    }
  });

  // Initial render
  runQrCheckout();
});

// Receipt page: fetch session details and render summary
document.addEventListener('DOMContentLoaded', () => {
  const isReceipt = /(^|\/)receipt\.html(\?|$)/.test(location.pathname) || document.body.classList.contains('receipt');
  if (!isReceipt) return;

  const params = new URLSearchParams(window.location.search);
  const sid = params.get('session_id');
  const receiptContainer = document.getElementById('receipt-container');
  const statusEl = document.getElementById('receipt-status');
  const emailEl = document.getElementById('receipt-email');

  const fmt = (cents, cur = 'USD') => {
    const n = Number(cents || 0) / 100;
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(cur).toUpperCase() }).format(n); } catch { return `$${n.toFixed(2)}`; }
  };
  const setStatus = (msg, kind = 'info') => {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = kind === 'error' ? '#b91c1c' : kind === 'success' ? '#065f46' : '#6b7280';
  };

  const setEmail = (email) => {
    if (!emailEl || !email) return;
    emailEl.textContent = email;
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

      // Prefer showing the user's email rather than rendering the full receipt details
      const sessionEmail = data.customer_email || data.customer_details?.email || data.receipt_email;
      if (sessionEmail) setEmail(sessionEmail);

      // Store receipt under user's account in Supabase (best-effort)
      try {
        if (window.sb) {
          const { data: u } = await window.sb.auth.getUser();
          const uid = u?.user?.id || null;
          const userEmail = u?.user?.email || null;
          if (userEmail) setEmail(userEmail);
          if (uid) {
            const currency = (data.currency || 'USD').toUpperCase();
            const session_id = data.id || sessionId;
            const amount_total_cents = Number(data.amount_total_cents ?? data.amount_total ?? 0) || 0;
            const items = Array.isArray(data.items) ? data.items : [];

            // Upsert receipt with items array into the items jsonb column
            const { data: receiptData, error: receiptError } = await window.sb.from('receipts').upsert(
              {
                user_id: uid,
                session_id,
                currency,
                amount_total_cents,
                items: items || []
              },
              { onConflict: 'session_id' }
            );

            if (receiptError) {
              console.warn('Failed to save receipt (non-fatal):', receiptError);
            } else {
              console.debug('Receipt saved successfully with', items.length, 'items');
            }

            // Send receipt email with checkout details
            try {
              if (window.sb?.functions?.invoke && userEmail && items.length > 0) {
                await window.sb.functions.invoke('send-checkout-email', {
                  body: {
                    user_id: uid,
                    user_email: userEmail,
                    items: items,
                    total_cents: amount_total_cents,
                    currency: currency
                  }
                });
                console.debug('Receipt email sent successfully');
              }
            } catch (emailErr) {
              console.warn('Failed to send receipt email (non-fatal)', emailErr);
            }
          }
        }
      } catch (e) {
        console.warn('Failed to store receipt/checkout in Supabase (non-fatal)', e);
      }

      // Clear cart after a successful checkout
      try { saveCart([]); renderCart(); } catch { }
      setStatus('Payment complete. Check your email for the receipt.', 'success');
    } catch (e) {
      console.error('Failed to load receipt', e);
      setStatus('Failed to load receipt', 'error');
    }
  }

  fetchDetails(sid);
});

// --- Inactivity Timer for Grid/Category Views ---
// On index, the category grid should fall back to the OpenSearch (main) view
// after idle. Activity must reliably reset that clock — listen on document in
// the capture phase so taps on cards, tabs, and the cart still count.
document.addEventListener('DOMContentLoaded', () => {
  const INACTIVITY_LIMIT_MS = 30 * 1000; // 30 seconds
  let inactivityTimer = null;

  const viewOpenSearch = document.getElementById('view-opensearch');
  const viewCategoryGrid = document.getElementById('view-category-grid');
  const isIndexPage = document.body.classList.contains('index');
  const isCategoryPage = document.body.classList.contains('category-page');

  // Only these pages need the grid/category idle revert.
  if (!isIndexPage && !isCategoryPage) return;

  function isGridOrCategoryActive() {
    if (isCategoryPage) return true;
    if (viewCategoryGrid && !viewCategoryGrid.classList.contains('hidden')) return true;
    return false;
  }

  function clearIdleTimer() {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  }

  function revertView() {
    clearIdleTimer();
    if (!isGridOrCategoryActive()) return;

    if (isCategoryPage) {
      // Back to the main OpenSearch index view (not the grid).
      window.location.href = typeof withCart === 'function' ? withCart('index.html') : 'index.html';
      return;
    }

    if (!viewOpenSearch || !viewCategoryGrid) return;

    viewCategoryGrid.style.opacity = '0';
    viewCategoryGrid.classList.add('hidden');
    viewCategoryGrid.classList.remove('fade-out-active');

    viewOpenSearch.classList.remove('hidden');
    viewOpenSearch.classList.remove('slow-fade-out');
    viewOpenSearch.style.opacity = '';
    document.body.classList.add('opensearch-active');

    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('view') === 'grid') {
        url.searchParams.delete('view');
        window.history.replaceState({}, '', url);
      }
    } catch (_) { }
  }

  function resetTimer() {
    clearIdleTimer();
    if (!isGridOrCategoryActive()) return;
    inactivityTimer = setTimeout(revertView, INACTIVITY_LIMIT_MS);
  }

  // Real interactions only — ignore mousemove/scroll noise so the timer means
  // "no taps", matching kiosk use. Capture phase so stopPropagation cannot skip us.
  const activityEvents = ['pointerdown', 'touchstart', 'mousedown', 'click', 'keydown'];
  activityEvents.forEach((evt) => {
    document.addEventListener(evt, () => {
      if (isGridOrCategoryActive()) resetTimer();
    }, { passive: true, capture: true });
  });

  // Start/stop when index swaps between OpenSearch and the category grid.
  if (viewCategoryGrid) {
    const observer = new MutationObserver(() => {
      if (isGridOrCategoryActive()) resetTimer();
      else clearIdleTimer();
    });
    observer.observe(viewCategoryGrid, { attributes: true, attributeFilter: ['class'] });
  }

  resetTimer();
});
