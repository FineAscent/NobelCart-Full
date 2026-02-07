-- Add show_allergy_caution column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS show_allergy_caution BOOLEAN DEFAULT TRUE;

-- Update RLS if needed (profiles usually allows update by owner)
-- Ensure 'Users can update own profile' policy exists and covers this column
-- (Standard profile policies usually cover all columns or are defined as USING(auth.uid() = id) WITH CHECK(auth.uid() = id))
