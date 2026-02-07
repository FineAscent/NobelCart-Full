-- ==========================================
-- SECURITY PATCHES FOR NOBELCART
-- Run this in your Supabase SQL Editor to fix 
-- the Critical & High vulnerabilities.
-- ==========================================

-- 1. FIX: CLIENT-SIDE ADMIN BYPASS
-- Enable RLS on profiles so users can't just "pretend" to be admins.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own profile
CREATE POLICY "Users can read own profile" 
ON profiles FOR SELECT 
TO authenticated 
USING (auth.uid() = id);

-- Allow Admins to read ALL profiles
CREATE POLICY "Admins can read all profiles" 
ON profiles FOR SELECT 
TO authenticated 
USING (
  (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
);

-- 2. FIX: DATA LEAKAGE (Monitor Page)
-- Enable RLS on active_sessions so normal users can't spy on others.
ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;

-- Allow users to insert/update ONLY their own session
CREATE POLICY "Users can manage own session" 
ON active_sessions FOR ALL 
TO authenticated 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Allow Admins to see ALL active sessions (for the Monitor page)
CREATE POLICY "Admins can view all sessions" 
ON active_sessions FOR SELECT 
TO authenticated 
USING (
  (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
);

-- 3. FIX: SECURE RECEIPTS
-- Ensure users only see their own receipts
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own receipts" 
ON receipts FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id); 
-- Note: You might need to adjust 'user_id' if your column is named differently (e.g. 'profile_id')
