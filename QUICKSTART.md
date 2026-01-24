# Quick Start: Deploy Checkout Data Persistence

## What Was Built
Your checkout flow now **automatically saves all purchase data to Supabase**, including:
- ✅ Product details (name, ID, quantity)
- ✅ Prices (unit & total in cents)
- ✅ Timestamps (when purchased)
- ✅ Receipt email (automatic)
- ✅ Weighted items support (e.g., produce)

## Deploy in 5 Minutes

### 1. Apply Database Changes (2 min)
```bash
cd /Users/muneerahmed/NobelCart-Full
supabase migration up
```

**What it does:** Creates `checkout_items` table to store individual product purchases.

### 2. Deploy Email Function (2 min)
```bash
supabase functions deploy send-checkout-email
```

**What it does:** Deploys the function that sends receipt emails.

### 3. Configure Email (1 min)
Go to **Supabase Dashboard** → **Project Settings** → **Edge Functions** → **Environment Variables**

Add these variables:
```
RESEND_API_KEY=sk_live_xxxxx...
FROM_EMAIL=noreply@nobelcart.com
```

Get your API key from [resend.com](https://resend.com)

*(Optional: If you skip this, checkout still works but no email is sent)*

## That's It! 🎉

Your app now:
1. ✅ Saves each checkout to Supabase
2. ✅ Stores individual items with prices & timestamps
3. ✅ Sends professional receipt email
4. ✅ Tracks purchase history per user
5. ✅ Supports weighted items (produce, etc.)

## Test It

1. Navigate to app: `http://localhost:8000`
2. Sign in or create account
3. Add items to cart
4. Click checkout
5. Complete payment (use test card: `4242 4242 4242 4242`)
6. ✅ See receipt, data saved, email sent

## View Purchase Data

**In browser console:**
```javascript
// Get all user's receipts
const receipts = await window.sb.from('receipts').select('*');
console.log(receipts.data);

// Get items from a purchase
const items = await window.sb.from('checkout_items').select('*').eq('receipt_id', 1);
console.log(items.data);
```

## Database Schema

### receipts table
- `id` - Receipt number
- `session_id` - Stripe session ID
- `amount_total_cents` - Total price in cents
- `currency` - USD, EUR, etc.
- `created_at` - Purchase timestamp

### checkout_items table (NEW)
- `product_name` - Name of product
- `quantity` - How many (can be decimal: 1.5kg)
- `unit_price_cents` - Price per unit
- `total_price_cents` - Quantity × unit price
- `is_weighted` - True if sold by weight
- `unit` - "kg", "lb", "oz", etc.
- `created_at` - Purchase timestamp

## Files Changed

| File | What Changed |
|------|--------------|
| `supabase/migrations/0007_checkout_items.sql` | **NEW** - Database table definition |
| `supabase/functions/send-checkout-email/index.ts` | **NEW** - Email sending function |
| `site.js` | Enhanced receipt page to save items & send email |
| `CHECKOUT_DATA_PERSISTENCE.md` | **NEW** - Full documentation |
| `IMPLEMENTATION_SUMMARY.md` | **NEW** - Visual overview |
| `TESTING_CHECKLIST.md` | **NEW** - Step-by-step testing |
| `checkout-data-queries.js` | **NEW** - Helper functions |

## Troubleshooting

**Migration fails?**
```bash
supabase migration reset  # Reset and try again
```

**Email not sending?**
- Verify `RESEND_API_KEY` is set in Supabase
- Check Edge Function logs: `supabase functions fetch-logs send-checkout-email`
- (Optional: checkout still works without email)

**Can't see saved data?**
```sql
-- In Supabase SQL Editor, verify tables exist:
SELECT table_name FROM information_schema.tables 
WHERE table_name IN ('receipts', 'checkout_items');
```

## Next Steps

1. ✅ Deploy & test (follow TESTING_CHECKLIST.md)
2. Build an "Order History" page to display receipts
3. Add refund tracking linked to purchases
4. Create analytics dashboard for spending trends
5. Export purchase history to CSV

## Questions?

All documentation is in the root folder:
- `IMPLEMENTATION_SUMMARY.md` - High-level overview
- `CHECKOUT_DATA_PERSISTENCE.md` - Complete technical details
- `TESTING_CHECKLIST.md` - Detailed testing steps
- `checkout-data-queries.js` - Browser console examples
