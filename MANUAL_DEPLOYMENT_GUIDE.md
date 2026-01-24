# Manual Deployment Guide

## Status Report ✅

### Completed
- ✅ Email function deployed: `send-checkout-email`
- ✅ Migration file created: `0007_checkout_items.sql`
- ✅ Site.js enhanced with checkout saving
- ✅ All documentation created

### Remaining Steps

## Step 1: Apply Database Migration (MANUAL)

Since CLI auth is having issues, apply the migration manually:

### Option A: Supabase Dashboard (Easiest)
1. Go to: https://supabase.com/dashboard/project/pkofxkcbdyqcunwjrnnx/sql/new
2. Copy all SQL from: `supabase/migrations/0007_checkout_items.sql`
3. Paste into the SQL editor
4. Click "Run" (or Ctrl+Enter)

### Option B: SQL Editor
1. Open Supabase Dashboard
2. Go to **SQL Editor**
3. Click **New Query**
4. Copy-paste this SQL:

```sql
-- Checkout Items table to track individual products purchased in each receipt
create table if not exists public.checkout_items (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  receipt_id bigint not null references public.receipts(id) on delete cascade,
  product_id text,
  product_name text not null,
  quantity numeric not null,
  unit_price_cents bigint not null,
  total_price_cents bigint not null,
  is_weighted boolean default false,
  unit text,
  created_at timestamptz not null default now()
);

-- Create index on user_id and receipt_id for faster queries
create index if not exists idx_checkout_items_user_id on public.checkout_items(user_id);
create index if not exists idx_checkout_items_receipt_id on public.checkout_items(receipt_id);
create index if not exists idx_checkout_items_created_at on public.checkout_items(created_at desc);

alter table public.checkout_items enable row level security;

-- Users can insert their own checkout items
do $$ begin
  create policy "insert_own_checkout_items"
    on public.checkout_items
    for insert
    to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Users can select their own checkout items
do $$ begin
  create policy "select_own_checkout_items"
    on public.checkout_items
    for select
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Users can update their own checkout items
do $$ begin
  create policy "update_own_checkout_items"
    on public.checkout_items
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
```

5. Click **Run**
6. You should see: "Success. No rows returned"

---

## Step 2: Verify Migration Applied ✅

In the same SQL Editor, run:

```sql
-- Check if table exists
SELECT table_name FROM information_schema.tables 
WHERE table_name = 'checkout_items';

-- Check table structure
\d checkout_items;

-- Check RLS policies
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE tablename = 'checkout_items';
```

**Expected Results:**
- Table `checkout_items` exists
- 9 columns visible
- 3 RLS policies listed

---

## Step 3: Configure Email (Optional but Recommended)

### Get Your Resend API Key
1. Go to https://resend.com
2. Sign up or log in
3. Go to **API Keys**
4. Create new API key
5. Copy the key (starts with `sk_live_` or `sk_test_`)

### Add to Supabase

1. Go to: https://supabase.com/dashboard/project/pkofxkcbdyqcunwjrnnx/settings/functions
2. Click **Environment Variables** (or **Settings**)
3. Add new variable:
   - Key: `RESEND_API_KEY`
   - Value: `sk_live_xxxxx...` (your key)
4. Click **Save**

5. Add optional variable:
   - Key: `FROM_EMAIL`
   - Value: `noreply@nobelcart.com`
6. Click **Save**

### Verify Function Deployed

Go to: https://supabase.com/dashboard/project/pkofxkcbdyqcunwjrnnx/functions

You should see:
- `send-checkout-email` - Status: Active

---

## Step 4: Test Everything

### 4.1 Test Database (SQL Editor)
```sql
-- Insert test checkout item (don't forget to replace user_id and receipt_id)
INSERT INTO checkout_items (user_id, receipt_id, product_name, quantity, unit_price_cents, total_price_cents)
VALUES ('12345678-1234-1234-1234-123456789012', 1, 'Test Item', 2, 500, 1000);

-- Verify it saved
SELECT * FROM checkout_items ORDER BY created_at DESC LIMIT 1;
```

### 4.2 Test in Browser

1. Go to your app (http://localhost:8000)
2. Sign in
3. Add items to cart
4. Complete checkout with test card: `4242 4242 4242 4242`
5. Check:
   - ✅ Receipt page shows "Thank you"
   - ✅ Supabase has receipt data
   - ✅ Supabase has checkout items
   - ✅ Email received (if RESEND_API_KEY set)

---

## Verification Checklist

- [ ] SQL migration applied in Supabase
- [ ] `checkout_items` table exists with 9 columns
- [ ] 3 RLS policies created
- [ ] Email function shows "Active" in dashboard
- [ ] RESEND_API_KEY set in environment variables
- [ ] Test checkout completed successfully
- [ ] Receipt saved to Supabase
- [ ] Checkout items visible in Supabase
- [ ] Email received (optional)

---

## Troubleshooting

### Migration fails with "table already exists"
This is fine! The table was already created. The `if not exists` clause prevents errors.

### Can't see checkout_items table
1. Refresh Supabase dashboard
2. Check you're looking in the right schema: `public`
3. Verify the SQL ran without errors (check for red errors in editor)

### Email not working
1. Verify RESEND_API_KEY is set correctly
2. Check function logs: Dashboard → Functions → send-checkout-email → Logs
3. Make sure email address is valid
4. Note: Checkout works fine without email

### RLS errors when trying to insert
Make sure you're inserting with a valid user_id and receipt_id that exist in your database.

---

## Next Steps

Once all steps above are complete:

1. **Build Order History Page** - Display user's past purchases
2. **Add Analytics** - Track spending trends
3. **Create Invoices** - Generate PDF receipts
4. **Enable Refunds** - Link to your refund system

---

## Quick Links

**Supabase Dashboard:**
https://supabase.com/dashboard/project/pkofxkcbdyqcunwjrnnx

**SQL Editor:**
https://supabase.com/dashboard/project/pkofxkcbdyqcunwjrnnx/sql/new

**Functions:**
https://supabase.com/dashboard/project/pkofxkcbdyqcunwjrnnx/functions

**Environment Variables:**
https://supabase.com/dashboard/project/pkofxkcbdyqcunwjrnnx/settings/functions

---

## Need Help?

If you get stuck:
1. Check the SQL error message in the editor
2. Verify table name (should be `checkout_items`, all lowercase)
3. Make sure policy IDs are unique (the `if not exists` helps with this)
4. Check the [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md) for detailed steps

**You've got this!** ✅
