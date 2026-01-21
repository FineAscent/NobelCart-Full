-- Create a table to store backups of profiles
CREATE TABLE IF NOT EXISTS public.profiles_backup (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  original_profile_id uuid NOT NULL,
  email text,
  is_admin boolean,
  active boolean,
  backup_created_at timestamptz DEFAULT now(),
  backup_reason text -- e.g., 'manual_backup', 'before_delete'
);

-- Enable RLS on the backup table
ALTER TABLE public.profiles_backup ENABLE ROW LEVEL SECURITY;

-- Allow admins to view and insert backups
CREATE POLICY "Admins can view all backups" ON public.profiles_backup
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can insert backups" ON public.profiles_backup
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

-- Function to backup all profiles (can be called from the frontend)
CREATE OR REPLACE FUNCTION backup_all_profiles(reason text DEFAULT 'manual_backup')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  count_backed_up integer;
BEGIN
  -- Check if the user calling this is an admin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied. Only admins can perform backups.';
  END IF;

  INSERT INTO public.profiles_backup (original_profile_id, email, is_admin, active, backup_reason)
  SELECT id, email, is_admin, active, reason
  FROM public.profiles;
  
  GET DIAGNOSTICS count_backed_up = ROW_COUNT;
  
  RETURN count_backed_up;
END;
$$;
