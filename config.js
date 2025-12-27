(function () {
  // Basic environment config for the customer site (read-only endpoints)
  const ENV = 'prod'; // change to 'dev' for dev stack
  const BASES = {
    prod: 'https://ov07pqkx1d.execute-api.us-east-1.amazonaws.com/dev',
    dev: 'https://ov07pqkx1d.execute-api.us-east-1.amazonaws.com/dev'
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
      }
    }
  } catch (_) {}
})();
