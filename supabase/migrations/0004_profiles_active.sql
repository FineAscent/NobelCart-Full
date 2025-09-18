-- 0004_profiles_active.sql
-- Add cart monitoring fields to profiles and broaden read policy for admin monitoring

-- Ensure optional columns on profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='email'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN email text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='active'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN active boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='last_seen'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN last_seen timestamptz;
  END IF;
END $$;

-- Helpful indexes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='profiles' AND indexname='idx_profiles_active'
  ) THEN
    CREATE INDEX idx_profiles_active ON public.profiles (active);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='profiles' AND indexname='idx_profiles_last_seen'
  ) THEN
    CREATE INDEX idx_profiles_last_seen ON public.profiles (last_seen DESC);
  END IF;
END $$;

-- RLS policies: allow authenticated users to read all profiles for admin monitoring
-- Note: If you prefer stricter access, replace this with a role-based policy.
DO $$ BEGIN
  DROP POLICY IF EXISTS "Profiles read any (auth)" ON public.profiles;
  CREATE POLICY "Profiles read any (auth)"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
