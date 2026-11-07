(function () {
  const article = document.getElementById('privacy-policy-content');
  if (article && window.ncPolicy) article.innerHTML = window.ncPolicy.HTML;
  // Preserve a device's cart identifier when returning to signup on the kiosk.
  const link = document.getElementById('signup-link');
  try {
    const cart = new URLSearchParams(location.search).get('cart') || localStorage.getItem('nc_cart_id');
    if (link && cart) link.href = 'create-account.html?cart=' + encodeURIComponent(cart);
  } catch (_) {}
})();
