// Phone gate: block phones from the kiosk UI.
//
// Allowed on phones (everything else redirects to bad.html?reason=phone):
//   - qr-approve.html  — phone sign-in / approve
//   - p.html           — Stripe payment QR handoff
//   - receipt.html     — Stripe thank-you / receipt
//   - bad.html         — already blocked (avoid loops)
//
// Tablets and desktop are NOT blocked: the cart hardware may be a tablet.
// Phones that "Request Desktop Website" are still caught via screen size + touch.
//
// Load this synchronously in <head> before other app scripts. Safe to include on
// allowlisted pages — it no-ops there.
(function () {
  try {
    var path = (location.pathname || '').toLowerCase();
    var file = path.split('/').pop() || '';
    if (!file || file === '') file = 'index.html';

    var ALLOW = {
      'qr-approve.html': 1,
      'qr-approve': 1,
      'p.html': 1,
      'p': 1,
      'receipt.html': 1,
      'receipt': 1,
      'bad.html': 1,
      'bad': 1
    };
    if (ALLOW[file]) return;

    function isPhone() {
      var ua = navigator.userAgent || '';
      var platform = navigator.platform || '';
      var touchPoints = navigator.maxTouchPoints || 0;
      var shortSide = Math.min(screen.width || 0, screen.height || 0);

      // Clear phone UAs first.
      if (/iPhone|iPod|Windows Phone|BlackBerry|BB10|IEMobile|Opera Mini/i.test(ua)) return true;
      if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true;

      // iPad / Android tablets — leave alone (kiosk may be a tablet).
      if (/iPad|Tablet/i.test(ua)) return false;
      if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return false;

      // iPadOS 13+ reports as MacIntel with touch. Real iPads have a larger
      // short side; iPhone "Request Desktop Website" keeps a phone-sized screen.
      if (platform === 'MacIntel' && touchPoints > 1 && !/iPhone|iPod/i.test(ua)) {
        if (shortSide > 520) return false;
        return true;
      }

      if (/Mobile/i.test(ua) && !/Tablet|iPad/i.test(ua)) return true;

      // Other desktop-mode phones: touch + phone-sized screen + desktop UA.
      if (touchPoints > 0 && shortSide > 0 && shortSide <= 520) {
        if (/Macintosh|Windows NT/i.test(ua)) return true;
      }

      return false;
    }

    if (!isPhone()) return;

    var dest = 'bad.html?reason=phone';
    // Admin pages live one folder down.
    if (path.indexOf('/admin/') !== -1) dest = '../bad.html?reason=phone';
    location.replace(dest);
  } catch (_) {
    // Never break page load if detection fails.
  }
})();
