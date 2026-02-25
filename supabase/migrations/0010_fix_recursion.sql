-- FIX INFINITE RECURSION IN PROFILES

-- 1. Drop the problematic recursive policies
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile." ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile." ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;

-- 2. Create simplified policies that avoid recursion
-- Allow users to read their own profile OR if they are an admin
-- BUT avoid looking up profiles.is_admin inside the policy for profiles itself recursively

-- Simple self-access policies (no recursion risk)
CREATE POLICY "Users can view own profile" ON public.profiles
FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
FOR INSERT WITH CHECK (auth.uid() = id);

-- Admin access policy without recursion:
-- We use a dedicated function designated SECURITY DEFINER to check admin status cleanly
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_admin = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Now use the function in the policy
CREATE POLICY "Admins can view all profiles" ON public.profiles
FOR SELECT USING (is_admin());

CREATE POLICY "Admins can update all profiles" ON public.profiles
FOR UPDATE USING (is_admin());

-- Ensure the column exists (idempotent)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS show_allergy_caution BOOLEAN DEFAULT TRUE;
