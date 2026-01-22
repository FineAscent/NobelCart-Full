// Virtual keyboard for Sign-in inputs (email & password)
(function(){
  const VK_ID = 'vk-auth';
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

    function key(label, opts={}) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vk-key' + (opts.special ? ' vk-key--special' : '') + (opts.space ? ' vk-key--space' : '') + (opts.done ? ' vk-key--done' : '');
      btn.textContent = label;
      btn.dataset.key = opts.code || label;
      return btn;
    }

    function renderRows() {
      // Clear all rows
      [row1,row2,row3,row4].forEach(r => { if (r) r.innerHTML = ''; });

      if (!isNumbersMode) {
        const r1 = ['q','w','e','r','t','y','u','i','o','p'];
        const r2 = ['a','s','d','f','g','h','j','k','l','←'];
        const r3 = ['z','x','c','v','b','n','m','@','.'];
        r1.forEach(k => row1.appendChild(key(k)));
        r2.forEach(k => row2.appendChild(key(k, { special: k==='←' })));
        r3.forEach(k => row3.appendChild(key(k)));
      } else {
        const n1 = ['1','2','3','4','5','6','7','8','9','0'];
        const n2 = ['-','_','/','\\',':',';','(',' )','$','&','←'];
        const n3 = ['@','.','!','?','#','%','+','=','*',','];
        n1.forEach(k => row1.appendChild(key(k)));
        n2.forEach(k => row2.appendChild(key(k, { special: k==='←' })));
        n3.forEach(k => row3.appendChild(key(k)));
      }

      // Bottom row: left mode toggle, center space, right done
      const modeLabel = isNumbersMode ? 'ABC' : '123';
      row4.appendChild(key(modeLabel, { special: true, code: 'MODE' }));
      row4.appendChild(key('Space', { space: true, code: 'SPACE', special: true }));
      row4.appendChild(key('Done', { done: true, code: 'DONE', special: true }));
    }

    // Initial render
    renderRows();

    let repeatDelayTimer = null;
    let repeatIntervalTimer = null;

    function stopRepeat() {
      if (repeatDelayTimer) clearTimeout(repeatDelayTimer);
      if (repeatIntervalTimer) clearInterval(repeatIntervalTimer);
      repeatDelayTimer = null;
      repeatIntervalTimer = null;
    }

    function processKey(btn) {
      if (!btn) return;
      const code = btn.dataset.key;
      if (!input) return;

      if (code === 'MODE') {
        isNumbersMode = !isNumbersMode;
        renderRows();
        if (input) { try { input.focus(); } catch(_){} }
        return;
      }
      if (code === 'DONE') {
        try {
          const ev = new CustomEvent('vk:done', { bubbles: true });
          (input || document).dispatchEvent(ev);
        } catch(_) {}
        hide();
        // blur the input to finalize
        try { input.blur(); } catch(_){}
        return;
      }
      if (code === 'SPACE') { insert(' '); return; }
      if (code === '←') { backspace(); return; }
      insert(btn.textContent.length >= 1 ? btn.textContent : '');
    }

    function startPress(e) {
      // Prevent focus loss from input when clicking keyboard
      if (e.cancelable) e.preventDefault();
      
      const btn = e.target.closest('.vk-key');
      if (!btn) return;

      stopRepeat();
      processKey(btn);

      const code = btn.dataset.key;
      // Don't repeat MODE or DONE
      if (code === 'MODE' || code === 'DONE') return;

      repeatDelayTimer = setTimeout(() => {
        repeatIntervalTimer = setInterval(() => {
          processKey(btn);
        }, 100);
      }, 500);
    }

    vkEl.addEventListener('mousedown', startPress);
    vkEl.addEventListener('touchstart', startPress, { passive: false });

    vkEl.addEventListener('mouseup', stopRepeat);
    vkEl.addEventListener('mouseleave', stopRepeat);
    vkEl.addEventListener('touchend', stopRepeat);
    vkEl.addEventListener('touchcancel', stopRepeat);

    return vkEl;
  }

  function insert(text) {
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const val = input.value || '';
    input.value = val.slice(0, start) + text + val.slice(end);
    const pos = start + text.length;
    try { input.setSelectionRange(pos, pos); } catch(_) {}
    input.focus();
    // Trigger input event for any listeners
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
      try { input.setSelectionRange(pos, pos); } catch(_) {}
    } else if (start !== end) {
      input.value = val.slice(0, start) + val.slice(end);
      try { input.setSelectionRange(start, start); } catch(_) {}
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

  function init() {
    // Try signin page fields first
    let email = document.getElementById('email');
    let password = document.getElementById('password');
    
    // If not found, try create-account page fields
    if (!email) email = document.getElementById('create-email');
    if (!password) password = document.getElementById('create-password');
    
    if (!email && !password) return;

    function bind(el) {
      if (!el) return;
      el.addEventListener('focus', () => { show(el); });
      el.addEventListener('blur', () => { hide(); });
    }

    bind(email);
    bind(password);

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
