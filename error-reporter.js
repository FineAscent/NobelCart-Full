// Kiosk error reporter — Step 3 of the error tracker.
//
// Catches uncaught JS / promise rejections on kiosk pages and sends them to
// the report-error edge function. Reports only when a member is signed in.
// Guests and phone-only pages are ignored.
//
// Load after config.js (needs window.sb). Safe no-op if auth is missing.
//
// Manual reports from catch blocks:
//   window.ncReportError({ message, source: 'supabase', stack })
(function () {
  try {
    var path = (location.pathname || '').toLowerCase();
    var file = path.split('/').pop() || 'index.html';
    if (!file) file = 'index.html';

    // Admin and phone-only flows are out of scope for this tracker.
    if (path.indexOf('/admin/') !== -1) return;
    var SKIP = {
      'qr-approve.html': 1, 'qr-approve': 1,
      'p.html': 1, 'p': 1,
      'receipt.html': 1, 'receipt': 1,
      'bad.html': 1, 'bad': 1
    };
    if (SKIP[file]) return;

    var SOURCES = { js: 1, supabase: 1, stripe: 1, network: 1, other: 1 };
    var recent = Object.create(null); // fingerprint → timestamp
    var DEDUPE_MS = 60 * 1000;
    var queue = [];
    var flushing = false;
    var installed = false;

    function pageName() {
      return file || location.pathname || 'unknown';
    }

    function cartId() {
      try {
        if (typeof window.ncCartId === 'function') return window.ncCartId() || null;
      } catch (_) { }
      try {
        return new URLSearchParams(location.search).get('cart') || null;
      } catch (_) {
        return null;
      }
    }

    function fingerprint(message, source) {
      return String(source || 'js') + '|' + pageName() + '|' + String(message || '').slice(0, 180);
    }

    function shouldDedupe(fp) {
      var now = Date.now();
      var last = recent[fp] || 0;
      if (now - last < DEDUPE_MS) return true;
      recent[fp] = now;
      // Opportunistic cleanup so the map does not grow forever on a long kiosk session.
      for (var k in recent) {
        if (now - recent[k] > DEDUPE_MS * 2) delete recent[k];
      }
      return false;
    }

    function isNoise(message) {
      var m = String(message || '');
      if (!m) return true;
      if (/Script error\.?/i.test(m)) return true; // cross-origin, no detail
      if (/ResizeObserver loop/i.test(m)) return true;
      if (/Loading chunk \d+ failed/i.test(m)) return true;
      if (/report-error/i.test(m)) return true;
      return false;
    }

    function normalizeSource(source, message) {
      var s = String(source || 'js').toLowerCase();
      if (SOURCES[s]) return s;
      var m = String(message || '');
      if (/supabase|postgrest|jwt/i.test(m)) return 'supabase';
      if (/stripe/i.test(m)) return 'stripe';
      if (/Failed to fetch|NetworkError|net::ERR/i.test(m)) return 'network';
      return 'other';
    }

    function enqueue(payload) {
      if (!payload || !payload.message) return;
      if (isNoise(payload.message)) return;

      var source = normalizeSource(payload.source, payload.message);
      var fp = fingerprint(payload.message, source);
      if (shouldDedupe(fp)) return;

      queue.push({
        page: pageName(),
        message: String(payload.message).slice(0, 1000),
        stack: payload.stack ? String(payload.stack).slice(0, 4000) : null,
        source: source,
        severity: payload.severity === 'warn' ? 'warn' : 'error',
        cart_id: cartId(),
      });

      flushQueue();
    }

    async function flushQueue() {
      if (flushing || !queue.length) return;
      if (!window.sb || !window.sb.functions || !window.sb.auth) return;

      flushing = true;
      try {
        var session = null;
        try {
          var res = await window.sb.auth.getSession();
          session = res?.data?.session || null;
        } catch (_) {
          session = null;
        }

        // Signed-in members only — drop the queue while signed out.
        if (!session) {
          queue.length = 0;
          return;
        }

        while (queue.length) {
          var item = queue.shift();
          try {
            await window.sb.functions.invoke('report-error', { body: item });
          } catch (_) {
            // Swallow — never let reporting break the kiosk.
          }
        }
      } finally {
        flushing = false;
      }
    }

    function install() {
      if (installed) return;
      installed = true;

      window.addEventListener('error', function (event) {
        try {
          var msg = event?.message || event?.error?.message || 'Uncaught error';
          var stack = event?.error?.stack || null;
          enqueue({ message: msg, stack: stack, source: 'js' });
        } catch (_) { }
      });

      window.addEventListener('unhandledrejection', function (event) {
        try {
          var reason = event?.reason;
          var msg = '';
          var stack = null;
          if (reason && typeof reason === 'object') {
            msg = reason.message || String(reason);
            stack = reason.stack || null;
          } else {
            msg = String(reason || 'Unhandled rejection');
          }
          enqueue({ message: msg, stack: stack, source: 'js' });
        } catch (_) { }
      });

      // When auth hydrates or the user signs in, flush anything queued.
      try {
        if (window.sb && window.sb.auth && window.sb.auth.onAuthStateChange) {
          window.sb.auth.onAuthStateChange(function () {
            flushQueue();
          });
        }
      } catch (_) { }

      // Late sb init (config.js race): retry a few times.
      var tries = 0;
      var boot = setInterval(function () {
        tries += 1;
        if (window.sb || tries > 20) {
          clearInterval(boot);
          flushQueue();
        }
      }, 250);
    }

    window.ncReportError = function (opts) {
      try { enqueue(opts || {}); } catch (_) { }
    };

    // Temporary test harness: open any kiosk page signed-in with ?test_error=1
    // then tap "Fire test error". Remove after verification.
    function installTestHarness() {
      try {
        if (!/([?&])test_error=1(?:&|$)/.test(location.search || '')) return;
        if (document.getElementById('nc-test-error-btn')) return;

        var btn = document.createElement('button');
        btn.id = 'nc-test-error-btn';
        btn.type = 'button';
        btn.textContent = 'Fire test error';
        btn.setAttribute('style',
          'position:fixed;right:16px;bottom:16px;z-index:99999;' +
          'padding:12px 14px;border:0;border-radius:12px;' +
          'background:#b3261e;color:#fff;font:600 14px/1.2 sans-serif;' +
          'box-shadow:0 8px 20px rgba(0,0,0,.25);cursor:pointer;');

        btn.addEventListener('click', function () {
          var stamp = new Date().toISOString();
          // Path A: explicit reporter (works even if throw is swallowed)
          enqueue({
            message: 'TEST explicit ncReportError ' + stamp,
            source: 'js',
            stack: 'test harness (explicit)',
          });
          // Path B: uncaught exception → window "error" listener
          setTimeout(function () {
            throw new Error('TEST uncaught throw ' + stamp);
          }, 50);
          btn.textContent = 'Fired — check Error Log';
        });

        document.body.appendChild(btn);
      } catch (_) { }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        install();
        installTestHarness();
      });
    } else {
      install();
      installTestHarness();
    }
  } catch (_) {
    // Never break page load.
  }
})();
