// Virtual keyboard for Cabinet search
(function () {
  const VK_ID = 'vk-cabinet';
  let vkEl = null;
  let input = null;
  let active = false;

  function ensureKeyboard() {
    if (vkEl) return vkEl;
    vkEl = document.createElement('div');
    vkEl.id = VK_ID;
    vkEl.className = 'vk';
    vkEl.style.display = 'none';
    vkEl.innerHTML = `
      <div class="vk-inner">
        <div class="vk-keys">
          <div class="vk-row" data-row="1"></div>
          <div class="vk-row" data-row="2"></div>
          <div class="vk-row" data-row="3"></div>
          <div class="vk-row" data-row="4"></div>
        </div>
      </div>
    `;
    document.body.appendChild(vkEl);

    const row1 = vkEl.querySelector('[data-row="1"]');
    const row2 = vkEl.querySelector('[data-row="2"]');
    const row3 = vkEl.querySelector('[data-row="3"]');
    const row4 = vkEl.querySelector('[data-row="4"]');

    let isNumbersMode = false;

    function key(label, opts = {}) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vk-key' + (opts.special ? ' vk-key--special' : '') + (opts.space ? ' vk-key--space' : '') + (opts.done ? ' vk-key--done' : '');
      btn.textContent = label;
      btn.dataset.key = opts.code || label;
      return btn;
    }

    function renderRows() {
      [row1, row2, row3, row4].forEach(r => { if (r) r.innerHTML = ''; });

      if (!isNumbersMode) {
        const r1 = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'];
        const r2 = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '←'];
        const r3 = ['z', 'x', 'c', 'v', 'b', 'n', 'm', '@', '.'];
        r1.forEach(k => row1.appendChild(key(k)));
        r2.forEach(k => row2.appendChild(key(k, { special: k === '←' })));
        r3.forEach(k => row3.appendChild(key(k)));
      } else {
        const n1 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
        const n2 = ['-', '_', '/', '\\', ':', ';', '(', ' )', '$', '&', '←'];
        const n3 = ['@', '.', '!', '?', '#', '%', '+', '=', '*', ','];
        n1.forEach(k => row1.appendChild(key(k)));
        n2.forEach(k => row2.appendChild(key(k, { special: k === '←' })));
        n3.forEach(k => row3.appendChild(key(k)));
      }

      const modeLabel = isNumbersMode ? 'ABC' : '123';
      row4.appendChild(key(modeLabel, { special: true, code: 'MODE' }));
      row4.appendChild(key('Space', { space: true, code: 'SPACE', special: true }));
      row4.appendChild(key('Done', { done: true, code: 'DONE', special: true }));
    }

    // initial render
    renderRows();

    vkEl.addEventListener('mousedown', (e) => {
      // Prevent focus loss from input when clicking keyboard
      e.preventDefault();
    });

    vkEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.vk-key');
      if (!btn) return;
      const code = btn.dataset.key;
      if (!input) return;

      if (code === 'MODE') {
        isNumbersMode = !isNumbersMode;
        renderRows();
        if (input) { try { input.focus(); } catch (_) { } }
        return;
      }
      if (code === 'DONE') {
        try {
          const ev = new CustomEvent('vk:done', { bubbles: true });
          (input || document).dispatchEvent(ev);
        } catch (_) { }
        hide();
        return;
      }
      if (code === 'SPACE') { insert(' '); return; }
      if (code === '←') { backspace(); return; }
      insert(btn.textContent.length === 1 ? btn.textContent : '');
    });

    return vkEl;
  }

  function insert(text) {
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const val = input.value || '';
    input.value = val.slice(0, start) + text + val.slice(end);
    const pos = start + text.length;
    try { input.setSelectionRange(pos, pos); } catch (_) { }
    input.focus();
    // Trigger input event for any listeners (e.g. filtering)
    const ev = new Event('input', { bubbles: true });
    input.dispatchEvent(ev);
  }

  function backspace() {
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const val = input.value || '';
    if (start === end && start > 0) {
      input.value = val.slice(0, start - 1) + val.slice(end);
      const pos = start - 1;
      try { input.setSelectionRange(pos, pos); } catch (_) { }
    } else if (start !== end) {
      input.value = val.slice(0, start) + val.slice(end);
      try { input.setSelectionRange(start, start); } catch (_) { }
    }
    input.focus();
    const ev = new Event('input', { bubbles: true });
    input.dispatchEvent(ev);
  }

  function show(targetInput) {
    input = targetInput;
    ensureKeyboard();
    if (!vkEl) return;
    vkEl.style.display = 'block';
    active = true;
    window.__vkActive = true;
  }

  function hide() {
    if (!vkEl) return;
    vkEl.style.display = 'none';
    active = false;
    window.__vkActive = false;
  }

  function toggle(targetInput) {
    if (!active) show(targetInput); else hide();
  }

  function init() {
    const searchInput = document.querySelector('.section-header .search-input');
    const searchIcon = document.querySelector('.section-header .search-icon');
    const container = document.querySelector('.section-header .search-container');
    if (!searchInput || !container) return;

    // Show VK on focus
    searchInput.addEventListener('focus', () => {
      show(searchInput);
    });

    // Hide VK when input loses focus (let site.js collapse it)
    searchInput.addEventListener('blur', () => {
      hide();
    });

    // When the search icon is clicked, wait for site.js to toggle expansion, then decide
    // When the search icon is clicked, wait for site.js to toggle expansion, then decide
    document.addEventListener('click', (e) => {
      const searchIcon = e.target.closest('.section-header .search-icon');
      if (searchIcon) {
        setTimeout(() => {
          const searchInput = document.querySelector('.section-header .search-input');
          const sectionHeader = searchIcon.closest('.section-header');
          const expanded = searchInput?.classList.contains('expanded') || sectionHeader?.classList.contains('expanded');
          if (expanded) {
            searchInput?.focus();
            show(searchInput);
          } else {
            hide();
          }
        }, 10);
      }
    });

    // Hide VK when pressing Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && active) hide();
    });

    window.addEventListener('beforeunload', hide);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
