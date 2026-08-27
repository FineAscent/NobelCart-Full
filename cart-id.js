// Cart id persistence for the kiosk.
//
// The cart id identifies the physical cart/device, not the customer, so it has to
// outlive individual sign-ins: customers sign in, check out or time out, and the
// next customer signs in to the same cart. It is kept in localStorage so it
// survives reloads, browser restarts and dropped wifi. A fresh ?cart= in the URL
// always wins, which is how a device picks up a new cart id.
//
// Must be loaded synchronously in <head>, before anything that gates on the id.
(function () {
  var KEY = 'nc_cart_id';

  function cleanCartId(raw) {
    var id = String(raw == null ? '' : raw).trim();
    if (!id) return '';
    try { id = decodeURIComponent(id); } catch (_) { }
    id = id.split(/[/?#]/)[0];
    if (/\.(html?|php)$/i.test(id)) return '';
    var m = id.match(/^[A-Za-z0-9._-]{1,64}/);
    return m ? m[0] : '';
  }

  function readStored() {
    var raw = '';
    try { raw = window.localStorage.getItem(KEY) || ''; } catch (_) { }
    // Earlier builds only wrote sessionStorage; keep reading it so an in-progress
    // session is not dropped on the deploy that introduces this file.
    if (!raw) {
      try { raw = window.sessionStorage.getItem(KEY) || ''; } catch (_) { }
    }
    var id = cleanCartId(raw);
    if (id && id !== raw) store(id);
    return id;
  }

  function store(id) {
    try { window.localStorage.setItem(KEY, id); } catch (_) { }
    try { window.sessionStorage.setItem(KEY, id); } catch (_) { }
  }

  // The URL wins; otherwise fall back to the last id this device saw.
  window.ncCartId = function () {
    var fromUrl = null;
    try { fromUrl = new URLSearchParams(window.location.search).get('cart'); } catch (_) { }
    if (fromUrl) {
      fromUrl = cleanCartId(fromUrl);
      if (!fromUrl) return readStored();
      store(fromUrl);
      return fromUrl;
    }
    return readStored();
  };

  // Gate for pages that must never load without a cart. Sends the user to bad.html
  // only when this device has never seen a cart id at all; otherwise it restores
  // the id into the URL.
  window.ncRequireCart = function () {
    var id = window.ncCartId();
    if (!id) {
      window.location.replace('bad.html');
      return '';
    }
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (_) { return id; }
    if (!params.get('cart')) {
      params.set('cart', id);
      window.location.replace(window.location.pathname + '?' + params.toString());
    }
    return id;
  };

  // Point a link at `path` with the cart id attached, so navigating never drops it.
  window.ncLinkWithCart = function (el, path) {
    var id = window.ncCartId();
    if (el && id) el.href = path + '?cart=' + encodeURIComponent(id);
  };
})();
