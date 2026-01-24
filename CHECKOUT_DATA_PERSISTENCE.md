# Checkout Data Persistence Implementation

## Overview
This implementation saves all checkout data to the user's profile in Supabase, including products purchased, quantities, prices, timestamps, and totals. An automatic receipt email is sent after successful payment.

## Changes Made

### 1. Database Migration: `0007_checkout_items.sql`
Created a new `checkout_items` table to track individual products in each purchase:

```
- id: Primary key
- user_id: References auth.users (for RLS)
- receipt_id: Foreign key to receipts table
- product_id: Original product ID from catalog
- product_name: Product name at time of purchase
- quantity: Number of items (can be decimal for weighted items)
- unit_price_cents: Price per unit in cents
- total_price_cents: Total line item price in cents
- is_weighted: Boolean flag for weighted products (e.g., produce by weight)
- unit: Unit of measurement (e.g., "kg", "lb", "oz")
- created_at: Timestamp of purchase
```

**Security**: Row-level security (RLS) policies ensure users can only access their own checkout items.

---

### 2. Edge Function: `send-checkout-email/index.ts`
New Supabase Edge Function that sends receipt emails to users after checkout.

**Features**:
- Generates professional HTML email with receipt details
- Displays itemized list with quantities, unit prices, and totals
- Shows receipt ID and timestamp
- Supports any currency format
- Gracefully handles missing email configuration (logs instead of failing)
- Uses Resend.com API if `RESEND_API_KEY` environment variable is set

**Environment Variables Required**:
```
RESEND_API_KEY=<your-resend-api-key>
FROM_EMAIL=noreply@nobelcart.com  # Optional, defaults to this
```

---

### 3. Client-Side Updates: `site.js`

#### Receipt Page Handler (Enhanced)
When a user completes checkout and lands on `receipt.html`:

1. **Saves Receipt Data**
   - Stores receipt in `receipts` table (already existed)
   - Retrieves the receipt ID from the response

2. **Saves Checkout Items**
   - Extracts items from Stripe session details
   - Maps each item to the `checkout_items` table with:
     - Product name & ID
     - Quantity (handles both regular and weighted items)
     - Unit price and total price in cents
     - Weighted flag and unit info

3. **Sends Receipt Email**
   - Calls `send-checkout-email` edge function
   - Passes user email, receipt ID, items, total, and currency
   - Handles errors gracefully (email failure doesn't block checkout)

#### Helper Functions Added

```javascript
// Fetch all receipts for the current user
fetchUserReceipts({ limit = 50, offset = 0 })

// Fetch checkout items for a specific receipt
fetchCheckoutItemsForReceipt(receiptId)

// Fetch all checkout items for user (paginated)
fetchUserCheckoutHistory({ limit = 100, offset = 0 })
```

These can be used in a future "Purchase History" or "Order History" page.

---

## Data Flow

```
1. User adds items to cart → stored in localStorage
2. User clicks "Checkout" → cart is locked into Stripe session
3. Stripe processes payment → redirects to receipt.html with session_id
4. Receipt page fetches session details from Stripe
5. Data saved to Supabase:
   ├── receipts table (summary)
   ├── checkout_items table (individual items) ← NEW
   └── send-checkout-email function called ← NEW
6. Email sent to user with itemized receipt
7. Cart cleared, user signed out, redirect to signin
```

---

## Database Queries

### View all user's purchases
```sql
SELECT 
  r.id, r.session_id, r.amount_total_cents, r.currency, r.created_at,
  COUNT(c.id) as item_count
FROM receipts r
LEFT JOIN checkout_items c ON r.id = c.receipt_id
WHERE r.user_id = $1
GROUP BY r.id
ORDER BY r.created_at DESC;
```

### View items for a specific receipt
```sql
SELECT * FROM checkout_items
WHERE receipt_id = $1
ORDER BY created_at ASC;
```

### View total spent by user
```sql
SELECT 
  SUM(amount_total_cents) as total_cents,
  COUNT(*) as purchase_count,
  currency
FROM receipts
WHERE user_id = $1
GROUP BY currency;
```

---

## How to Deploy

### 1. Apply Database Migration
```bash
supabase migration up
```

### 2. Deploy Edge Functions
```bash
supabase functions deploy send-checkout-email
```

### 3. Set Environment Variables in Supabase Dashboard
```
RESEND_API_KEY = <your-resend-api-key>
FROM_EMAIL = noreply@nobelcart.com
```

### 4. Verify RLS Policies
The migration includes RLS policies for:
- Users can insert their own checkout_items
- Users can select their own checkout_items
- Users can update their own checkout_items

---

## Testing Workflow

1. **Sign in** or create account
2. **Add items to cart** (various product types including weighted)
3. **Proceed to checkout**
4. **Complete Stripe payment**
5. **Verify receipt page loads** with all items
6. **Check email** for receipt (if RESEND_API_KEY configured)
7. **Query Supabase**:
   ```javascript
   // In browser console:
   const receipts = await window.sb.from('receipts').select('*');
   const items = await window.sb.from('checkout_items').select('*');
   console.log(receipts, items);
   ```

---

## Error Handling

- **Email service unavailable**: Checkout still succeeds, user is notified
- **Database save fails**: Non-fatal, logged to console but doesn't block checkout
- **Missing user data**: Gracefully uses empty strings/defaults
- **Weighted items**: Special handling for quantity as decimal, tracked with `is_weighted` flag

---

## Future Enhancements

1. **Order History Page**: Display all user receipts and checkout items
2. **Refund Integration**: Link to existing refund system with receipt context
3. **CSV Export**: Let users export their purchase history
4. **Analytics**: Track top products, spending trends per user
5. **Duplicate Prevention**: Prevent accidental double-saves with idempotency
6. **Webhook Sync**: Listen for Stripe webhook events for async updates
