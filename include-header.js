document.addEventListener('DOMContentLoaded', () => {
  const placeholder = document.getElementById('header-placeholder');
  if (!placeholder) return;

  const inlineHeader = `
<div class="header">
  <a class="user-info" href="account.html" style="text-decoration:none;color:inherit;display:flex;align-items:center;gap:8px;">
    <div class="user-avatar">👤</div>
    <span id="header-user-label">User</span>
  </a>
  <div class="dots">
    <div class="dot"></div>
    <div class="dot"></div>
    <div class="dot"></div>
    <div class="dot"></div>
  </div>
</div>
`;

  const applyUserLabel = async () => {
    try {
      const label = document.getElementById('header-user-label');
      if (!label) return;
      if (window.sb) {
        const { data } = await window.sb.auth.getUser();
        const email = data?.user?.email;
        if (email) label.textContent = email;
      }
    } catch {}
  };

  const loadViaFetch = () =>
    fetch('/header.html', { cache: 'no-store' })
      .then((resp) => {
        if (!resp.ok) throw new Error('Failed to load header.html');
        return resp.text();
      })
      .then((html) => { 
        placeholder.innerHTML = html; 
        applyUserLabel(); 
      })
      .catch((err) => {
        console.error('Header include error:', err);
        // Fallback for file:// or any CORS/permissions issues
        placeholder.innerHTML = inlineHeader;
        applyUserLabel();
      });

  // If running from file:// protocol, fetch will typically fail due to CORS.
  // Inject inline header immediately; otherwise try fetch first.
  if (location.protocol === 'file:') {
    placeholder.innerHTML = inlineHeader;
    applyUserLabel();
  } else {
    loadViaFetch();
  }
});

