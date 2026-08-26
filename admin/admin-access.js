// Shared admin access helpers.
//
// Levels:
//   1 — Refunds + Monitor + Approve Checkout
//   2 — same as 1 for now (reserved)
//   3 — full admin menu
//
// Page keys map to the minimum level required.
(function () {
  var PAGE_MIN_LEVEL = {
    index: 1,
    refund: 1,
    monitor: 1,
    'approve-checkout': 1,
    users: 3,
    status: 3,
    errors: 3,
    backup: 3,
  };

  function levelOf(prof) {
    if (!prof || !prof.is_admin) return 0;
    var n = Number(prof.admin_level);
    return n >= 1 && n <= 3 ? n : 1;
  }

  function canAccess(pageKey, level) {
    var need = PAGE_MIN_LEVEL[pageKey] || 3;
    return Number(level) >= need;
  }

  /**
   * Guard the current admin page. Redirects to the admin menu (or sign-in)
   * when the caller is not allowed.
   * @param {string} pageKey
   * @returns {Promise<{prof: object, level: number}|null>}
   */
  async function requireAdminPage(pageKey) {
    try {
      if (!window.sb) {
        window.location.href = '../signin.html?admin=1';
        return null;
      }
      var sessionRes = await window.sb.auth.getSession();
      var session = sessionRes && sessionRes.data && sessionRes.data.session;
      if (sessionRes.error || !session) {
        try { await window.sb.auth.signOut({ scope: 'local' }); } catch (_) { }
        window.location.href = '../signin.html?admin=1';
        return null;
      }
      var uid = session.user.id;
      var { data: prof } = await window.sb
        .from('profiles')
        .select('is_admin, admin_level, email')
        .eq('id', uid)
        .single();
      var level = levelOf(prof);
      if (!prof || !prof.is_admin || level < 1) {
        alert('Admin access required.');
        window.location.href = '../index.html';
        return null;
      }
      if (!canAccess(pageKey, level)) {
        alert('Admin level ' + (PAGE_MIN_LEVEL[pageKey] || 3) + ' required for this page.');
        window.location.href = 'index.html';
        return null;
      }
      return { prof: prof, level: level, userId: uid };
    } catch (_) {
      try { await window.sb.auth.signOut({ scope: 'local' }); } catch (_) { }
      window.location.href = '../signin.html?admin=1';
      return null;
    }
  }

  /** Hide menu cards the current level cannot open. */
  function filterAdminMenu(level) {
    document.querySelectorAll('[data-admin-min]').forEach(function (card) {
      var need = Number(card.getAttribute('data-admin-min') || 3);
      if (Number(level) < need) card.style.display = 'none';
    });
  }

  window.ncAdminAccess = {
    PAGE_MIN_LEVEL: PAGE_MIN_LEVEL,
    levelOf: levelOf,
    canAccess: canAccess,
    requireAdminPage: requireAdminPage,
    filterAdminMenu: filterAdminMenu,
  };
})();
