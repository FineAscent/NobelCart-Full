# Testing Checklist: Checkout Data Persistence

## Prerequisites
- [ ] Supabase project set up with auth enabled
- [ ] Stripe account configured
- [ ] Node.js and Supabase CLI installed locally
- [ ] Environment variables set (STRIPE_SECRET_KEY, etc.)

## Step 1: Deploy Database Migration
```bash
cd /Users/muneerahmed/NobelCart-Full
supabase migration up
```

**Expected Result:**
- [ ] No errors during migration
- [ ] Can see new `checkout_items` table in Supabase dashboard
- [ ] RLS policies applied to `checkout_items` table

**Verify in Supabase Dashboard:**
```sql
-- Run in SQL Editor
SELECT table_name FROM information_schema.tables 
WHERE table_name IN ('receipts', 'checkout_items')
ORDER BY table_name;
```

---

## Step 2: Deploy Edge Function
```bash
supabase functions deploy send-checkout-email
```

**Expected Result:**
- [ ] Function deployed successfully
- [ ] No build errors
- [ ] Can see function in Supabase dashboard under Edge Functions

**Verify in Dashboard:**
- Go to `Edge Functions` → `send-checkout-email`
- Click on function details
- Should show successful deployments

---

## Step 3: Set Environment Variables
Go to Supabase Project Settings → Edge Functions → Environment Variables

Add:
```
RESEND_API_KEY=sk_live_... (or sk_test_...)
FROM_EMAIL=noreply@nobelcart.com
```

**Expected Result:**
- [ ] Environment variables saved
- [ ] No validation errors

---

## Step 4: Test the Complete Flow

### 4.1 Start Application Locally
```bash
# Serve the application
python3 -m http.server 8000
# or
npx http-server
```

**Expected Result:**
- [ ] Application loads at `http://localhost:8000`
- [ ] No console errors

### 4.2 Sign In or Create Account
- [ ] Navigate to sign in page
- [ ] Sign in with test email or create account
- [ ] Successfully authenticated (should see user menu or profile)

### 4.3 Add Items to Cart
- [ ] Browse products (index.html, category, cabinet)
- [ ] Double-click or add items to cart
- [ ] See items appear in cart sidebar with price and quantity
- [ ] **For weighted items**: Enter weight when prompted
- [ ] Cart total updates correctly

**Expected Result:**
- [ ] Cart displays all items correctly
- [ ] Subtotal is calculated correctly
- [ ] localStorage shows cart items (check DevTools → Application → localStorage)

### 4.4 Go to Checkout
- [ ] Click cart or "Checkout" button
- [ ] Navigate to `checkout.html`
- [ ] Name fields auto-populate with user data

**Expected Result:**
- [ ] QR code appears
- [ ] "Scan to pay" message visible
- [ ] Cart summary shows on the right

### 4.5 Complete Payment
**Option A: QR Code Scanner**
- [ ] Scan QR with phone
- [ ] Mobile checkout page loads
- [ ] Payment form appears
- [ ] Enter test card: `4242 4242 4242 4242`
- [ ] Enter any future expiry date
- [ ] Enter any 3-digit CVC
- [ ] Complete payment

**Option B: Click Link**
- [ ] Click "Open checkout in browser" link
- [ ] Stripe checkout page loads
- [ ] Complete payment with test card

**Test Card:**
- Number: `4242 4242 4242 4242`
- Expiry: Any future date (e.g., 12/25)
- CVC: Any 3 digits (e.g., 123)

**Expected Result:**
- [ ] Payment processes
- [ ] "Payment complete" message appears
- [ ] Redirects to receipt.html

---

## Step 5: Verify Receipt Page

### 5.1 Receipt Display
- [ ] Receipt page loads with "Thank you" message
- [ ] Email address displayed (user's email)
- [ ] "Payment complete" status message shown

**Expected Result:**
- [ ] No JavaScript errors in console
- [ ] User is redirected to signin after ~1 second

### 5.2 Check Database Records

**In Supabase SQL Editor, run:**

```sql
-- Check if receipt was saved
SELECT id, session_id, amount_total_cents, currency, created_at 
FROM public.receipts 
WHERE user_id = '(your-user-id)'
ORDER BY created_at DESC 
LIMIT 1;
```

**Expected Result:**
- [ ] Receipt row exists
- [ ] `amount_total_cents` is correct (in cents)
- [ ] `currency` is set (e.g., "USD")
- [ ] `created_at` is recent

```sql
-- Check if checkout items were saved
SELECT product_name, quantity, unit_price_cents, total_price_cents, is_weighted, unit, created_at
FROM public.checkout_items
WHERE receipt_id = (the-receipt-id-from-above)
ORDER BY created_at;
```

**Expected Result:**
- [ ] All items appear in checkout_items table
- [ ] Quantities match what was ordered
- [ ] Prices are in cents (multiply by 100)
- [ ] Timestamps are all recent and similar
- [ ] `is_weighted` is true only for weighted items

### 5.3 Check Browser Console
- [ ] No errors in DevTools console
- [ ] See logs like "Checkout items saved successfully"
- [ ] See log confirming email function called

---

## Step 6: Verify Email Receipt

### 6.1 Email Service Check
```javascript
// In browser console (while on receipt page)
// The email function should have been called automatically
```

**Check Email:**
- [ ] Check inbox for email from `noreply@nobelcart.com`
- [ ] Subject includes "Receipt Confirmation" and receipt ID
- [ ] Email contains itemized list of products
- [ ] Shows quantities, prices, and total
- [ ] Date and time are correct
- [ ] All HTML formatting looks professional

**If Email Not Received:**

Check Supabase Edge Function logs:
```bash
supabase functions list
supabase functions fetch-logs send-checkout-email
```

Expected logs should show:
- [ ] Function was invoked
- [ ] Email payload passed correctly
- [ ] Resend API called (if RESEND_API_KEY configured)
- [ ] Response received

---

## Step 7: Test Multiple Purchases

### 7.1 Repeat checkout 2-3 times
- [ ] Add different items to cart
- [ ] Complete payment
- [ ] Verify data saved

### 7.2 Verify Multiple Receipts
```sql
SELECT COUNT(*) as receipt_count
FROM public.receipts
WHERE user_id = '(your-user-id)';

SELECT COUNT(*) as item_count
FROM public.checkout_items
WHERE user_id = '(your-user-id)';
```

**Expected Result:**
- [ ] Multiple receipts saved
- [ ] Total items matches all purchases combined

---

## Step 8: Test Weighted Items

### 8.1 Add Weighted Item
- [ ] Find product with weight (e.g., produce)
- [ ] Double-click to add
- [ ] Enters weight in modal (e.g., 1.5)
- [ ] Item added to cart with weight quantity

### 8.2 Check Checkout Item
```sql
SELECT product_name, quantity, is_weighted, unit, unit_price_cents, total_price_cents
FROM public.checkout_items
WHERE is_weighted = true
LIMIT 5;
```

**Expected Result:**
- [ ] `is_weighted` is `true`
- [ ] `quantity` is decimal (e.g., 1.5)
- [ ] `unit` shows measurement (e.g., "kg")
- [ ] `total_price_cents` = `quantity × unit_price_cents`

---

## Step 9: Test Error Handling

### 9.1 Disable Email Service (Optional)
- [ ] Remove/clear `RESEND_API_KEY` env variable
- [ ] Redeploy function: `supabase functions deploy send-checkout-email`
- [ ] Complete another purchase

**Expected Result:**
- [ ] Checkout still completes successfully
- [ ] No email sent (but data still saved to DB)
- [ ] Message indicates email not configured

### 9.2 Check Offline Behavior
- [ ] Go offline (disable network)
- [ ] Try to view receipt data

**Expected Result:**
- [ ] RLS policies prevent access if not logged in
- [ ] Proper error message shown

---

## Step 10: Security Testing

### 10.1 Test RLS Policies
```javascript
// Try to access another user's data
// Create 2 test accounts (email1, email2)
// Sign in as user1, add to cart, checkout
// Sign in as user2, try to query user1's receipts
```

**Expected Result:**
- [ ] User2 cannot see User1's receipts
- [ ] Error: "new row violates row-level security policy"

### 10.2 Verify Session Isolation
- [ ] Open app in 2 browsers (different sessions)
- [ ] Each user sees only their own data
- [ ] Cross-user data access denied

---

## Step 11: Helper Functions Test

**In browser console:**

```javascript
// Test fetchUserReceipts
const receipts = await fetchUserReceipts({ limit: 10 });
console.log('Receipts:', receipts);

// Test fetchCheckoutItemsForReceipt
const items = await fetchCheckoutItemsForReceipt(receipts[0].id);
console.log('Items:', items);

// Test fetchUserCheckoutHistory
const history = await fetchUserCheckoutHistory({ limit: 20 });
console.log('History:', history);
```

**Expected Result:**
- [ ] Functions return data without errors
- [ ] Data matches database queries
- [ ] Timestamps are properly formatted

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Migration fails | Check if tables already exist; run `supabase migration reset` |
| Email not sent | Verify `RESEND_API_KEY` is set; check function logs |
| Checkout items not saving | Check browser console for errors; verify RLS policies |
| RLS policy error | Ensure user is authenticated; check policy definitions |
| Function deploy fails | Check TypeScript syntax; verify environment vars |
| Email looks wrong | Check HTML template in function; test with different browser |

---

## Final Verification Checklist

- [ ] Database tables created
- [ ] Edge function deployed
- [ ] Email service configured (optional)
- [ ] Full checkout flow works
- [ ] Receipt saved to database
- [ ] Checkout items saved individually
- [ ] Email sent with receipt details
- [ ] Multiple purchases tracked
- [ ] Weighted items handled correctly
- [ ] Security policies working
- [ ] Error handling tested
- [ ] Helper functions working

**All items checked? You're ready to go live! 🎉**
