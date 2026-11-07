// A short fade that can be undone before it commits. The old pane stays in
// flow until faded, so a shrinking card never cuts through a visible QR code.
function createSigninPanelTransition(email, phone, reduced, schedule = setTimeout, cancel = clearTimeout) {
  const panels = { email, phone };
  let displayed = 'email', timer = null;
  const settle = mode => {
    Object.entries(panels).forEach(([name, panel]) => {
      panel.style.display = name === mode ? (name === 'email' ? 'flex' : 'block') : 'none';
      panel.style.position = '';
      panel.style.opacity = name === mode ? '1' : '0';
      panel.inert = name !== mode;
      panel.setAttribute('aria-hidden', String(name !== mode));
      panel.classList.remove('is-out', 'is-await-fields');
    });
    displayed = mode;
  };
  settle(displayed);
  return mode => {
    if (timer !== null) { cancel(timer); timer = null; }
    if (mode === displayed || reduced()) { settle(mode); return; }
    const outgoing = panels[displayed], incoming = panels[mode];
    outgoing.style.opacity = '0';
    outgoing.inert = true;
    incoming.style.display = mode === 'email' ? 'flex' : 'block';
    incoming.style.position = 'absolute';
    incoming.style.opacity = '0';
    incoming.inert = true;
    timer = schedule(() => { timer = null; settle(mode); }, 100);
  };
}

function createSigninWelcomeVisibility(title, isMoving, keyboardActive) {
  let inputActive = false;
  const refresh = () => {
    if (!title) return;
    const hidden = inputActive || isMoving() || keyboardActive();
    title.classList.toggle('is-dismissed', hidden);
    title.setAttribute('aria-hidden', String(hidden));
  };
  return { refresh, setActive(active) { inputActive = active; refresh(); } };
}

// Move the card and resize only its painted surface. Animating layout height
// inside a bottom-aligned flex row makes the bottom edge move twice per frame.
function animateSigninCard(card, surface, before, after) {
  const timing = { duration: 320, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' };
  const move = card.animate([
    { transform: `translateY(${before.bottom - after.bottom}px)` },
    { transform: 'translateY(0)' },
  ], timing);
  const paint = surface.animate([
    { transform: `scaleY(${before.height / Math.max(1, after.height)})` },
    { transform: 'scaleY(1)' },
  ], timing);
  return { move, paint };
}

// Touch interaction and measured card resizing for the sign-in method switch.
function bindSigninModeDrag(bar, email, phone) {
  let gesture = null;
  let suppressClick = false;
  const reset = () => {
    bar.classList.remove('is-dragging');
    bar.style.removeProperty('--signin-thumb-offset');
    gesture = null;
  };
  bar.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || phone.disabled) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
      start: bar.dataset.mode === 'phone' ? 1 : 0, progress: 0, dragging: false };
  });
  bar.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.dragging) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { reset(); return; }
      if (Math.abs(dx) < 8) return;
      gesture.dragging = true;
      bar.setPointerCapture(event.pointerId);
      bar.classList.add('is-dragging');
    }
    const travel = (bar.clientWidth - 4) / 2;
    gesture.progress = Math.max(0, Math.min(1, gesture.start + dx / travel));
    bar.style.setProperty('--signin-thumb-offset', `${gesture.progress * travel}px`);
  });
  bar.addEventListener('pointerup', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const { dragging, progress } = gesture;
    reset();
    if (!dragging) return;
    // Select through the same click handlers used by taps and keyboard users.
    (progress >= 0.5 ? phone : email).click();
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
  });
  bar.addEventListener('pointercancel', reset);
  bar.addEventListener('lostpointercapture', reset);
  bar.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
}

(function () {
  const bar = document.querySelector('.signin-mode-switch');
  const email = document.getElementById('email-signin-tab');
  const phone = document.getElementById('qr-signin-btn-top');
  if (!bar || !email || !phone) return;
  bindSigninModeDrag(bar, email, phone);

  const card = document.querySelector('.signin-center .auth-card');
  const title = document.getElementById('signin-title');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const form = document.getElementById('signin-form');
  const qr = document.getElementById('qr-app-panel');
  if (form && qr) window.ncSigninSetPanel = createSigninPanelTransition(form, qr, () => reduced.matches || card?.classList.contains('is-keyboard-changing'));
  const welcome = createSigninWelcomeVisibility(title,
    () => card?.classList.contains('is-keyboard-changing'), () => !!window.__vkActive);
  document.addEventListener('focus', event => {
    welcome.setActive(!!event.target.matches?.('#signin-form .auth-input'));
  }, true);
  document.addEventListener('focusout', event => {
    if (event.target.matches?.('#signin-form .auth-input')) {
      welcome.setActive(!!event.relatedTarget?.matches?.('#signin-form .auth-input'));
    }
  });

  if (!card || !window.ResizeObserver) return;
  const content = document.createElement('div');
  content.className = 'signin-card-content';
  // Keep the fixed OTP overlay outside the measured flow.
  Array.from(card.childNodes).forEach(node => {
    if (!node.classList?.contains('otp-overlay')) content.appendChild(node);
  });
  card.prepend(content);
  const surface = document.createElement('div');
  surface.className = 'signin-card-surface';
  surface.setAttribute('aria-hidden', 'true');
  card.prepend(surface);
  const measure = () => {
    const style = getComputedStyle(card);
    const extra = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
      .reduce((sum, key) => sum + parseFloat(style[key] || 0), 0);
    const height = Math.round(content.getBoundingClientRect().height + extra);
    if (card.style.height !== `${height}px`) card.style.height = `${height}px`;
  };
  let resizeFrame = null;
  const resize = () => {
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => { resizeFrame = null; measure(); });
  };
  measure();
  new ResizeObserver(resize).observe(content);

  let keyboardMotion = null, surfaceMotion = null, beforeKeyboard = null, keyboardFrame = null;
  let lastKeyboardVisible = false, lastKeyboardHeight = 0;
  const visibleRect = () => keyboardMotion ? surface.getBoundingClientRect() : card.getBoundingClientRect();
  const capture = () => { beforeKeyboard = { rect: visibleRect(), time: performance.now() }; };
  // Capture before the input's focus handler collapses the other field.
  document.addEventListener('focus', event => {
    if (event.target.matches?.('#signin-form .auth-input')) capture();
  }, true);
  document.addEventListener('pointerdown', event => {
    if (event.target.matches?.('#signin-form .auth-input')) capture();
  }, true);
  window.addEventListener('nc:keyboard-will-change', () => {
    if (!beforeKeyboard || performance.now() - beforeKeyboard.time > 100) capture();
  });
  document.addEventListener('vk:visibility', event => {
    const { visible, height } = event.detail;
    if (visible === lastKeyboardVisible && height === lastKeyboardHeight) return;
    lastKeyboardVisible = visible;
    lastKeyboardHeight = height;
    const before = beforeKeyboard?.rect || visibleRect();
    beforeKeyboard = null;
    keyboardMotion?.cancel();
    surfaceMotion?.cancel();
    keyboardMotion = null;
    surfaceMotion = null;
    const appearance = getComputedStyle(card);
    if (!card.classList.contains('is-keyboard-changing')) {
      card.style.setProperty('--signin-card-surface-color', appearance.backgroundColor);
      card.style.setProperty('--signin-card-surface-border', appearance.borderTopColor);
    }
    card.classList.add('is-keyboard-changing');
    welcome.refresh();
    if (keyboardFrame !== null) cancelAnimationFrame(keyboardFrame);
    keyboardFrame = requestAnimationFrame(() => {
      keyboardFrame = null;
      // Resolve the final field/card geometry once. Keyboard and card then share
      // one 320ms clock, including when the user reverses halfway through.
      measure();
      const after = card.getBoundingClientRect();
      if (reduced.matches || !card.animate) {
        card.classList.remove('is-keyboard-changing');
        welcome.refresh();
        return;
      }
      const { move: motion, paint } = animateSigninCard(card, surface, before, after);
      keyboardMotion = motion;
      surfaceMotion = paint;
      motion.finished.then(() => {
        if (keyboardMotion !== motion) return;
        keyboardMotion = null;
        surfaceMotion = null;
        card.classList.remove('is-keyboard-changing');
        welcome.refresh();
      }).catch(() => {});
    });
  });
})();
