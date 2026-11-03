// One-finger vertical dragging for kiosk touch panels, including devices that
// report touches as mouse pointers. Updates are coalesced to the display frame.
function initKioskDragScroll() {
  if (!window.PointerEvent) return;
  document.body.classList.add('kiosk-drag-enabled');
  const panes = '.left-section, .right-section .cart-items, .checkout-right .cart-items, #view-category-grid, .cart-items-container, .policy-scroll, .auth-wrapper, .weight-modal';
  const controls = 'input, textarea, select, label, [contenteditable="true"], .section-header, .vk';
  let drag = null;
  let frame = null;
  let suppressClick = false;
  let coast = null;
  const clamp = (pane, top) => Math.max(0, Math.min(top, pane.scrollHeight - pane.clientHeight));

  function stopFrame() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    coast = null;
  }

  function findPane(target) {
    let pane = target.closest(panes);
    while (pane) {
      if (pane.scrollHeight > pane.clientHeight + 1) return pane;
      pane = pane.parentElement?.closest(panes);
    }
    return null;
  }

  function draw(now) {
    frame = null;
    if (drag?.dragging) {
      drag.pane.scrollTop = drag.top;
      return;
    }
    if (!coast) return;
    const elapsed = Math.max(0, now - coast.at);
    const decay = Math.exp(-0.006 * elapsed);
    const top = coast.pane.scrollTop;
    const next = clamp(coast.pane, top + coast.velocity * (1 - decay) / 0.006);
    coast.pane.scrollTop = next;
    coast.velocity *= decay;
    coast.at = now;
    if (Math.abs(next - top) < 0.1 || Math.abs(coast.velocity) < 0.025) {
      coast = null;
      return;
    }
    frame = requestAnimationFrame(draw);
  }

  document.addEventListener('pointerdown', event => {
    if (drag) finish({ pointerId: drag.id, type: 'pointercancel', timeStamp: event.timeStamp });
    stopFrame();
    suppressClick = false;
    if (!['touch', 'mouse', 'pen'].includes(event.pointerType) || event.button !== 0 || !event.isPrimary ||
        event.target.closest(controls) ||
        (event.pointerType === 'mouse' && event.target.closest('button, a, [role="button"]'))) return;
    const pane = findPane(event.target);
    if (!pane) return;
    drag = {
      pane, id: event.pointerId, x: event.clientX, y: event.clientY,
      lastY: event.clientY, lastAt: event.timeStamp,
      startTop: pane.scrollTop, top: pane.scrollTop,
      limit: Math.max(0, pane.scrollHeight - pane.clientHeight), velocity: 0, dragging: false, axis: null
    };
  }, { capture: true, passive: true });

  document.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (drag.axis === 'horizontal') {
      event.preventDefault();
      return;
    }
    if (!drag.dragging) {
      const vertical = Math.abs(event.clientY - drag.y);
      const horizontal = Math.abs(event.clientX - drag.x);
      if (Math.max(vertical, horizontal) < 6) return;
      if (horizontal > vertical) {
        // A sideways gesture is ignored for its entire duration, including
        // the synthetic click, even if the finger later moves downwards.
        drag.axis = 'horizontal';
        suppressClick = true;
        document.dispatchEvent(new CustomEvent('nc:drag-scroll'));
        event.preventDefault();
        return;
      }
      drag.axis = 'vertical';
      drag.dragging = true;
      drag.pane.classList.add('is-drag-scrolling');
      try { drag.pane.setPointerCapture(drag.id); } catch (_) { }
      document.dispatchEvent(new CustomEvent('nc:drag-scroll'));
    }
    event.preventDefault();
    const elapsed = event.timeStamp - drag.lastAt;
    if (elapsed > 0) {
      const speed = (drag.lastY - event.clientY) / elapsed;
      drag.velocity = Math.max(-2, Math.min(2, speed * 0.7 + drag.velocity * 0.3));
    }
    drag.lastY = event.clientY;
    drag.lastAt = event.timeStamp;
    drag.top = Math.max(0, Math.min(drag.limit, drag.startTop + drag.y - event.clientY));
    if (frame === null) frame = requestAnimationFrame(draw);
  }, { capture: true, passive: false });

  function finish(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const ended = drag;
    drag = null;
    stopFrame();
    if (!ended.dragging) return;
    ended.pane.scrollTop = ended.top;
    ended.pane.classList.remove('is-drag-scrolling');
    suppressClick = true;
    try { ended.pane.releasePointerCapture(ended.id); } catch (_) { }
    if (event.type === 'pointerup' && event.timeStamp - ended.lastAt < 120 &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
        Math.abs(ended.velocity) >= 0.025) {
      coast = { pane: ended.pane, velocity: ended.velocity, at: performance.now() };
      frame = requestAnimationFrame(draw);
    }
  }
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => {
    document.addEventListener(type, finish, { capture: true, passive: true });
  });
  document.addEventListener('click', event => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });
  // Wheel/keyboard input or a hidden page takes over immediately from momentum.
  ['wheel', 'keydown', 'visibilitychange'].forEach(type => {
    document.addEventListener(type, stopFrame, { capture: true, passive: true });
  });
  window.addEventListener('blur', () => {
    if (drag) finish({ pointerId: drag.id, type: 'blur', timeStamp: performance.now() });
    stopFrame();
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initKioskDragScroll);
  else initKioskDragScroll();
}
