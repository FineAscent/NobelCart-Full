-- Serialize SMS notifications from the Stripe webhook and receipt landing page.
alter table public.receipts
  add column if not exists sms_sent_at timestamptz,
  add column if not exists sms_sending_at timestamptz;
