/* Shared catalog search for category and cabinet views. */
(function (root) {
  'use strict';

  function normalize(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Damerau-Levenshtein also accepts adjacent swapped letters (ribs -> risb).
  function distance(a, b) {
    const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) rows[i][0] = i;
    for (let j = 0; j <= b.length; j++) rows[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1,
          rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
        }
      }
    }
    return rows[a.length][b.length];
  }

  function score(product, query) {
    const name = normalize(product.name);
    const barcode = normalize(product.barcode);
    if (name === query || (barcode && barcode === query)) return 1000;
    if (name.startsWith(query)) return 900;
    if (name.includes(query) || (barcode && barcode.includes(query))) return 800;
    const words = name.split(' ');
    let total = 0;
    const tokens = query.split(' ');
    for (const token of tokens) {
      let best = 0;
      for (const word of words) {
        if (word === token) best = Math.max(best, 750);
        else if (word.startsWith(token)) best = Math.max(best, 650);
        else if (word.includes(token)) best = Math.max(best, 550);
        else if (token.length >= 3 && !/\d/.test(token)) {
          const allowed = token.length >= 6 ? 2 : 1;
          if (Math.abs(token.length - word.length) <= allowed) {
            const edits = distance(token, word);
            if (edits <= allowed) best = Math.max(best, 400 - edits * 50);
          }
        }
      }
      if (!best) return 0; // Every query word must match.
      total += best;
    }
    return total / tokens.length;
  }

  function groupMatches(products, rawQuery, currentCategory = '') {
    const query = normalize(rawQuery);
    if (!query) return [];
    const groups = new Map();
    const seen = new Set();
    for (const product of products) {
      const relevance = score(product, query);
      if (!relevance) continue;
      const category = String(product.category || '').trim() || 'Other';
      const key = normalize(category);
      const identity = product.id != null ? String(product.id) : `${key}:${normalize(product.name)}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (!groups.has(key)) groups.set(key, { category, key, matches: [] });
      groups.get(key).matches.push({ product, relevance });
    }
    for (const group of groups.values()) {
      group.matches.sort((a, b) => b.relevance - a.relevance ||
        String(a.product.name).localeCompare(String(b.product.name)));
    }
    const preferred = normalize(currentCategory);
    return [...groups.values()].sort((a, b) =>
      Number(b.key === preferred) - Number(a.key === preferred) ||
      b.matches[0].relevance - a.matches[0].relevance || a.category.localeCompare(b.category));
  }

  function attach({ input, browseElements, anchor, currentCategory, getProducts, renderProducts }) {
    if (!input || !anchor) return;
    const panel = document.createElement('div');
    panel.className = 'catalog-search-results';
    panel.hidden = true;
    const status = document.createElement('p');
    status.className = 'catalog-search-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const content = document.createElement('div');
    panel.append(status, content);
    anchor.after(panel);
    let revision = 0;
    let timer;

    async function update() {
      const version = ++revision;
      const query = normalize(input.value);
      browseElements.forEach(el => { el.hidden = Boolean(query); });
      panel.hidden = !query;
      content.replaceChildren();
      if (!query) { status.textContent = ''; return; }
      status.textContent = 'Searching products…';
      try {
        const products = await getProducts();
        if (version !== revision) return;
        const groups = groupMatches(products, query, currentCategory);
        const count = groups.reduce((sum, group) => sum + group.matches.length, 0);
        status.textContent = count ? `${count} ${count === 1 ? 'match' : 'matches'}` : 'No matching products. Try another name.';
        for (const group of groups) {
          const section = document.createElement('section');
          section.className = 'catalog-search-group';
          const heading = document.createElement('h2');
          heading.className = 'catalog-search-heading';
          heading.textContent = group.category;
          const grid = document.createElement('div');
          grid.className = 'products-grid';
          section.append(heading, grid);
          content.append(section);
          // Existing cards preserve images, location tags, and add-to-cart behavior.
          Promise.resolve(renderProducts(grid, group.matches.map(match => match.product))).catch(() => {});
        }
      } catch (_) {
        if (version !== revision) return;
        status.textContent = 'Unable to search products. Clear search to browse, or type again to retry.';
      }
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      ++revision; // Invalidate in-flight requests immediately, before the debounce.
      if (!normalize(input.value)) update();
      else timer = setTimeout(update, 150);
    });
    return { update };
  }

  const api = { normalize, groupMatches, attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NobelCatalogSearch = api;
})(typeof window !== 'undefined' ? window : globalThis);
