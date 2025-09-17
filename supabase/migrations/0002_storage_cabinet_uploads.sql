-- 0002_storage_cabinet_uploads.sql
-- Creates a private bucket for cabinet uploads and per-user RLS policies.

-- Create bucket if it doesn't exist
insert into storage.buckets (id, name, public)
select 'cabinet-uploads', 'cabinet-uploads', false
where not exists (
  select 1 from storage.buckets where id = 'cabinet-uploads'
);

-- Read own files
drop policy if exists "Cabinet read own files" on storage.objects;
create policy "Cabinet read own files"
  on storage.objects for select
  using (
    bucket_id = 'cabinet-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Insert/Update/Delete own files
drop policy if exists "Cabinet write own files" on storage.objects;
create policy "Cabinet write own files"
  on storage.objects for all
  using (
    bucket_id = 'cabinet-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'cabinet-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
