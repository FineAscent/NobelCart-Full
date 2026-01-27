-- Add email_sent column to receipts to prevent duplicate emails
alter table public.receipts 
add column if not exists email_sent boolean not null default false;

-- Index for faster filtering if needed
create index if not exists idx_receipts_email_sent on public.receipts(email_sent);
