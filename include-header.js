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

  async function tryFetch(url) {
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) throw new Error('not ok');
      return await resp.text();
    } catch {
      return null;
    }
  }

  async function loadHeader() {
    // Try relative paths based on current page depth
    const candidates = [
      'header.html',        // pages in root
      '../header.html',     // pages in /admin
      './header.html'       // generic relative
    ];
    for (const url of candidates) {
      const html = await tryFetch(url);
      if (html) {
        placeholder.innerHTML = html;
        await applyUserLabel();
        return;
      }
    }
    // Fallback: inline
    placeholder.innerHTML = inlineHeader;
    await applyUserLabel();
  }

  // If running from file:// protocol, fetch will typically fail due to CORS.
  // Inject inline header immediately; otherwise try fetch first.
  if (location.protocol === 'file:') {
    placeholder.innerHTML = inlineHeader;
    applyUserLabel();
  } else {
    loadHeader();
  }
});
