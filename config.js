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
            storage: window.sessionStorage,        // scope session to this tab/app
            storageKey: 'nc_cart_auth',            // avoid sharing with other apps
          },
        });
        try {
          // Expose a readiness promise for pages to await before using sb
          window.sbReady = (async () => {
            try { await window.sb.auth.getSession(); } catch (_) {}
            return window.sb;
          })();
        } catch (_) {}
      }
    }
  } catch (_) {}
})();
