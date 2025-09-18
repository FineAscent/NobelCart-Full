-- 0004_profiles_active.sql
-- Extend profiles with email and active flags, idempotently
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
END $$;

-- Allow any authenticated user to read rows where active = true (for admin active-carts view)
drop policy if exists "Profiles read active" on public.profiles;
create policy "Profiles read active"
  on public.profiles
  for select
  to authenticated
  using (active is true);
