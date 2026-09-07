// Virtual keyboard for Sign-in inputs (email & password)
(function () {
  const VK_ID = 'vk-auth';
  let vkEl = null;
  let input = null;
  let active = false;
  /** Ordered focus chain: Done advances; last field submits the form. */
  let fieldOrder = [];

  function updateDoneLabel() {
    if (!vkEl || !input) return;
    const doneBtn = vkEl.querySelector('.vk-key--done');
    if (!doneBtn) return;
    if (input.id === 'otp-input') {
      doneBtn.textContent = 'Verify';
      return;
    }
    const idx = fieldOrder.indexOf(input);
    const isLast = idx < 0 || idx >= fieldOrder.length - 1;
    if (document.body.classList.contains('create-account')) {
      doneBtn.textContent = isLast ? 'Create' : 'Done';
      return;
    }
    // Keep "Done" for next-field (what shoppers tap); last field signs in.
    doneBtn.textContent = isLast ? 'Sign In' : 'Done';
  }

  function revealForFocus(el) {
    if (!el) return;
    const body = document.body;
    const focusClasses = [
      'focus-email', 'focus-password', 'focus-name', 'focus-phone', 'focus-dob',
    ];
    body.classList.remove(...focusClasses);
    const field = el.dataset && el.dataset.field;
    if (field) body.classList.add('focus-' + field);
    body.classList.add('keyboard-visible');
  }

  function advanceOrSubmit() {
    const current = input;
    if (!current) {
      hide();
      return;
    }
    try {
      current.dispatchEvent(new CustomEvent('vk:done', { bubbles: true }));
    } catch (_) { }

    if (current.id === 'otp-input') {
      const btn = document.getElementById('otp-verify-btn');
      if (btn) btn.click();
      return;
    }

    // Create-account carousel owns Done / Create progression.
    if (typeof window.ncSignupSteps?.handleVkDone === 'function') {
      try {
        if (window.ncSignupSteps.handleVkDone(current)) return;
      } catch (_) { }
    }
    if (typeof window.__signupSteps?.handleVkDone === 'function') {
      try {
        if (window.__signupSteps.handleVkDone(current)) return;
      } catch (_) { }
    }
    // Sign-in: block email → password until identifier is a real email or +1 phone.
    if (typeof window.ncSigninGate?.handleVkDone === 'function') {
      try {
        if (window.ncSigninGate.handleVkDone(current)) return;
      } catch (_) { }
    }

    const idx = fieldOrder.indexOf(current);
    const next = idx >= 0 ? fieldOrder[idx + 1] : null;
    if (next) {
      // Spotlight CSS collapses the inactive field; reveal it before focus
      // so WebKit/kiosk browsers actually move caret into password.
      revealForFocus(next);
      input = next;
      updateDoneLabel();
      // Defer focus until after layout applies the focus-* class change.
      setTimeout(() => {
        try { next.focus({ preventScroll: false }); } catch (_) {
          try { next.focus(); } catch (__) { }
        }
        show(next);
      }, 0);
      return;
    }

    hide();
    try { current.blur(); } catch (_) { }
    const form = current.form || current.closest('form');
    if (!form) return;
    try {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    } catch (_) { }
  }

  // Press feedback: the cabinet hardware has no haptics, so a highlighted key
  // plus a preview bubble is the only way a shopper can spot a mistap.
  function createFeedback(vkEl) {
    const preview = document.createElement('div');
    preview.className = 'vk-preview';
    preview.setAttribute('aria-hidden', 'true');
    vkEl.appendChild(preview);

    let pressedBtn = null;
    let hideTimer = null;

    function labelFor(btn) {
      const code = btn.dataset.key;
      if (code === 'SPACE') return 'Space';
      if (code === '←') return 'Delete';
      const text = (btn.textContent || '').trim();
      return text.length === 1 ? text.toUpperCase() : text;
    }

    function press(btn) {
      if (!btn) return;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (pressedBtn && pressedBtn !== btn) pressedBtn.classList.remove('is-pressed');
      pressedBtn = btn;
      btn.classList.add('is-pressed');

      if (btn.dataset.key === 'DONE') { preview.classList.remove('is-visible'); return; }

      const label = labelFor(btn);
      preview.textContent = label;
      preview.classList.toggle('vk-preview--wide', label.length > 1);

      const vkRect = vkEl.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const center = btnRect.left - vkRect.left + btnRect.width / 2;
      preview.style.left = Math.min(Math.max(center, 48), Math.max(vkRect.width - 48, 48)) + 'px';
      preview.style.bottom = (vkRect.bottom - btnRect.top + 10) + 'px';

      // Replay the entry spring on every tap, including when the bubble is
      // already up and only moving to another key.
      preview.style.animation = 'none';
      void preview.offsetWidth;
      preview.style.animation = '';
      preview.classList.add('is-visible');
    }

    function release() {
      if (pressedBtn) { pressedBtn.classList.remove('is-pressed'); pressedBtn = null; }
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { preview.classList.remove('is-visible'); }, 400);
    }

    function clear() {
      if (pressedBtn) { pressedBtn.classList.remove('is-pressed'); pressedBtn = null; }
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      preview.classList.remove('is-visible');
    }

    return { press, release, clear };
  }

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
      // Clear all rows
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

      // Bottom row: left mode toggle, center space, right done
      const modeLabel = isNumbersMode ? 'ABC' : '123';
      row4.appendChild(key(modeLabel, { special: true, code: 'MODE' }));
      row4.appendChild(key('Space', { space: true, code: 'SPACE', special: true }));
      row4.appendChild(key('Done', { done: true, code: 'DONE', special: true }));
    }

    vkEl.__setNumbersMode = (on) => {
      const next = !!on;
      if (isNumbersMode === next) {
        updateDoneLabel();
        return;
      }
      isNumbersMode = next;
      renderRows();
      updateDoneLabel();
    };

    // Initial render
    renderRows();

    const feedback = createFeedback(vkEl);
    vkEl.__vkFeedback = feedback;

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
        feedback.clear();
        updateDoneLabel();
        if (input) { try { input.focus(); } catch (_) { } }
        return;
      }
      if (code === 'DONE') {
        advanceOrSubmit();
        return;
      }
      if (code === 'SPACE') { insert(' '); return; }
      if (code === '←') { backspace(); return; }
      insert(btn.textContent.length >= 1 ? btn.textContent : '');
    }

    // Touch devices often synthesize a click/mousedown after touchstart.
    // Without this, Done advances to password then immediately submits.
    let lastTouchAt = 0;

    function startPress(e) {
      // Prevent focus loss from input when clicking keyboard
      if (e.cancelable) e.preventDefault();

      if (e.type === 'touchstart') {
        lastTouchAt = Date.now();
      } else if (e.type === 'mousedown' && Date.now() - lastTouchAt < 700) {
        return;
      }

      const btn = e.target.closest('.vk-key');
      if (!btn) return;

      stopRepeat();
      feedback.press(btn);
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

    function endPress() {
      stopRepeat();
      feedback.release();
    }

    vkEl.addEventListener('mouseup', endPress);
    vkEl.addEventListener('mouseleave', endPress);
    vkEl.addEventListener('touchend', endPress);
    vkEl.addEventListener('touchcancel', endPress);

    return vkEl;
  }

  function insert(text) {
    if (!input) return;
    if (input.dataset.field === 'dob' || input.id === 'create-dob') {
      text = String(text || '').replace(/\D/g, '');
      if (!text) return;
    }
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const val = input.value || '';
    input.value = val.slice(0, start) + text + val.slice(end);
    const pos = start + text.length;
    try { input.setSelectionRange(pos, pos); } catch (_) { }
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
    const wantNumbers = !!(
      targetInput?.dataset?.vkMode === 'numbers' ||
      targetInput?.dataset?.field === 'dob' ||
      targetInput?.dataset?.field === 'phone' ||
      targetInput?.dataset?.field === 'otp' ||
      targetInput?.id === 'create-dob' ||
      targetInput?.id === 'create-phone' ||
      targetInput?.id === 'otp-input'
    );
    if (typeof vkEl.__setNumbersMode === 'function') {
      vkEl.__setNumbersMode(wantNumbers);
    } else {
      updateDoneLabel();
    }
    ensureVisible(targetInput);
    try {
      document.dispatchEvent(new CustomEvent('vk:visibility', { detail: { visible: true } }));
    } catch (_) { }
  }

  function hide(force) {
    if (!force && document.body.classList.contains('otp-open')) return;
    if (!vkEl) return;
    if (vkEl.__vkFeedback) vkEl.__vkFeedback.clear();
    vkEl.style.display = 'none';
    active = false;
    window.__vkActive = false;
    try {
      document.dispatchEvent(new CustomEvent('vk:visibility', { detail: { visible: false } }));
    } catch (_) { }
  }

  function init() {
    // Page-specific chains (only elements that exist on this page are kept)
    fieldOrder = [
      document.getElementById('email'),
      document.getElementById('password'),
      document.getElementById('create-name'),
      document.getElementById('create-dob'),
      document.getElementById('create-phone'),
      document.getElementById('create-email'),
      document.getElementById('create-password'),
      document.getElementById('checkout-first-name'),
      document.getElementById('checkout-last-name'),
      document.getElementById('checkout-full-name'),
    ].filter(Boolean);

    const targets = fieldOrder.slice();
    const otpInputEl = document.getElementById('otp-input');
    if (otpInputEl && !targets.includes(otpInputEl)) targets.push(otpInputEl);
    if (targets.length === 0) return;

    function bind(el) {
      if (!el) return;
      el.addEventListener('focus', () => { show(el); });
      el.addEventListener('blur', () => {
        // Small delay to allow focus to move to another input or for click to register
        setTimeout(() => {
          // Keep VK up on OTP until the user verifies (or leaves via Change my email).
          if (document.body.classList.contains('otp-open')) {
            const otp = document.getElementById('otp-input');
            if (otp) {
              try { otp.focus({ preventScroll: true }); } catch (_) {
                try { otp.focus(); } catch (__) {}
              }
              show(otp);
            }
            return;
          }
          let newFocus = document.activeElement;
          // Closed-shadow sign-in hosts report as the host, not the inner input.
          const hosts = window.ncAuthHosts || {};
          if (newFocus && (newFocus === hosts.email || newFocus === hosts.password)) {
            return;
          }
          if (window.ncAuthInputs) {
            if (newFocus === window.ncAuthInputs.email || newFocus === window.ncAuthInputs.password) {
              return;
            }
          }
          // If the new focused element is not in our list of targets, close the VK
          if (!targets.includes(newFocus)) {
            hide();
          }
        }, 150);
      });
      // Also prevent native keyboard on mobile / kiosk
      el.setAttribute('inputmode', 'none');
    }

    targets.forEach(bind);

    // Hide VK when pressing Escape (not during OTP verify)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && active && !document.body.classList.contains('otp-open')) hide();
    });

    window.addEventListener('beforeunload', hide);
  }

  function ensureVisible(el) {
    if (!el || !vkEl) return;
    if (document.body.classList.contains('create-account')) return;

    // Wait for VK to render/display
    setTimeout(() => {
      const vkRect = vkEl.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const keyboardHeight = vkRect.height || 300; // fallback

      // Calculate the 'safe zone' limit (top of the keyboard)
      const limit = viewportHeight - keyboardHeight;

      // If the bottom of the input is below the limit (covered by keyboard)
      // or very close to it
      if (elRect.bottom > limit - 20) {
        const scrollAmount = elRect.bottom - limit + 40; // +40 for padding

        // Check if we are in the checkout scrollable container
        const checkoutLeft = el.closest('.checkout-left');
        if (checkoutLeft) {
          checkoutLeft.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        } else {
          // Fallback for body/window scrolling (like on signin)
          window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        }
      }
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
