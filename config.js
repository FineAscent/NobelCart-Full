(function () {
  // Basic environment config for the customer site (read-only endpoints)
  const ENV = 'prod'; // change to 'dev' for dev stack
  const BASES = {
    prod: 'https://w2bspt32w4.execute-api.us-east-1.amazonaws.com/prod',
    dev: 'https://w2bspt32w4.execute-api.us-east-1.amazonaws.com/dev'
  };

  // Supabase configuration (client-safe)
  const SUPABASE_URL = 'https://pkofxkcbdyqcunwjrnnx.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrb2Z4a2NiZHlxY3Vud2pybm54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU1NzU0NTksImV4cCI6MjA3MTE1MTQ1OX0.OXyJ9EOJRo4YHf7TKVoeWMFPr9B9djrq9fciBSm0i0U';

  window.APP_CONFIG = {
    ENV,
    API_BASE: BASES[ENV],
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
  };

  // If supabase-js CDN is loaded, create a global client once
  try {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      if (!window.sb) {
        window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
          },
        });
        // Wrap signOut globally to ensure inactive flag is updated everywhere
        try {
          const originalSignOut = window.sb.auth.signOut.bind(window.sb.auth);
          window.sb.auth.signOut = async function wrappedSignOut(options) {
            try { if (window.markProfileInactive) await window.markProfileInactive(); } catch {}
            return originalSignOut(options);
          };
        } catch (_) {}
        // Helpers to mark profile active/inactive
        window.markProfileActive = async function markProfileActive() {
          try {
            const { data: u } = await window.sb.auth.getUser();
            const uid = u?.user?.id;
            const email = u?.user?.email || null;
            if (!uid) return;
            try { localStorage.setItem('nc_last_uid', uid); } catch {}
            try { if (email) localStorage.setItem('nc_last_email', email); } catch {}
            await window.sb.from('profiles').upsert({ id: uid, email, active: true, last_seen: new Date().toISOString() });
          } catch (_) {}
        };
        window.markProfileInactive = async function markProfileInactive() {
          try {
            let uid = null, email = null;
            try {
              const { data: u } = await window.sb.auth.getUser();
              uid = u?.user?.id || null;
              email = u?.user?.email || null;
            } catch {}
            if (!uid) { try { uid = localStorage.getItem('nc_last_uid') || null; } catch {} }
            if (!email) { try { email = localStorage.getItem('nc_last_email') || null; } catch {} }
            if (!uid) return;
            await window.sb.from('profiles').upsert({ id: uid, email, active: false, last_seen: new Date().toISOString() });
          } catch (_) {}
        };
        // Listen to auth state changes globally
        try {
          window.sb.auth.onAuthStateChange(async (event) => {
            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
              try { await window.markProfileActive(); } catch {}
              // Start heartbeat when signed in
              try {
                if (window.__ncHeartbeat) clearInterval(window.__ncHeartbeat);
                window.__ncHeartbeat = setInterval(async () => {
                  try {
                    const { data } = await window.sb.auth.getSession();
                    if (data && data.session) {
                      // Refresh last_seen and keep active true
                      await window.markProfileActive();
                    }
                  } catch {}
                }, 20000); // every 20s
              } catch {}
            } else if (event === 'SIGNED_OUT') {
              try { await window.markProfileInactive(); } catch {}
              try { if (window.__ncHeartbeat) { clearInterval(window.__ncHeartbeat); window.__ncHeartbeat = null; } } catch {}
            }
          });
        } catch (_) {}
        // If a session already exists on load, mark active
        try {
          window.sb.auth.getSession().then(async ({ data }) => {
            if (data && data.session) {
              try { await window.markProfileActive(); } catch {}
              // Start heartbeat immediately on load if already signed in
              try {
                if (window.__ncHeartbeat) clearInterval(window.__ncHeartbeat);
                window.__ncHeartbeat = setInterval(async () => {
                  try {
                    const { data } = await window.sb.auth.getSession();
                    if (data && data.session) {
                      await window.markProfileActive();
                    }
                  } catch {}
                }, 20000);
              } catch {}
            }
          }).catch(() => {});
        } catch (_) {}
      }
    }
  } catch (_) {}
})();
