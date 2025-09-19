-- 0005_realtime_active_sessions.sql
-- Ensure active_sessions is included in the realtime publication
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.active_sessions;
  EXCEPTION WHEN undefined_object THEN
    -- publication not found; ignore in local dev
    NULL;
  END;
END $$;
