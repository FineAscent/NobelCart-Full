// API Reference: Supabase Edge Functions

// ============================================
// send-checkout-email Edge Function
// ============================================
// 
// POST /functions/v1/send-checkout-email
//
// Request Body:
// {
//   "user_id": "uuid-string",           // User's ID from auth.users
//   "receipt_id": 123,                  // ID from receipts table
//   "user_email": "user@example.com",   // User's email address
//   "items": [
//     {
//       "product_id": "prod-123",
//       "product_name": "Tomato",
//       "quantity": 2.5,                // Can be decimal for weighted items
//       "unit_price_cents": 250,        // 2.50 per unit
//       "total_price_cents": 625,       // 2.5 * 250
//       "is_weighted": true,
//       "unit": "kg"
//     },
//     {
//       "product_name": "Milk",
//       "quantity": 1,
//       "unit_price_cents": 350,
//       "total_price_cents": 350,
//       "is_weighted": false,
//       "unit": null
//     }
//   ],
//   "total_cents": 975,                 // 625 + 350
//   "currency": "USD"
// }
//
// Response Success (200):
// {
//   "ok": true,
//   "message": "Receipt email sent successfully",
//   "email_sent": true,
//   "email_id": "resend-email-id-xxx"
// }
//
// Response No Email Service (200):
// {
//   "ok": true,
//   "message": "Receipt saved (email service not configured)",
//   "email_sent": false
// }
//
// Response Error (4xx/5xx):
// {
//   "error": "Missing user_email"
// }
//
// Environment Variables Required:
// - RESEND_API_KEY (optional, if not set, email is skipped)
// - FROM_EMAIL (optional, defaults to noreply@nobelcart.com)


// ============================================
// How It's Called from site.js
// ============================================

// After receipt is saved to Supabase, the code calls:
/*
await window.sb.functions.invoke('send-checkout-email', {
  body: {
    user_id: uid,
    receipt_id: receiptId,
    user_email: userEmail,
    items: checkoutItems,           // Array of checkout_items
    total_cents: amount_total_cents,
    currency: currency
  }
});
*/


// ============================================
// Database: receipts Table (Existing)
// ============================================
/*
CREATE TABLE public.receipts (
  id bigserial primary key,
  user_id uuid not null references auth.users(id),
  session_id text not null unique,    -- Stripe session ID
  currency text not null default 'USD',
  amount_total_cents bigint not null default 0,
  items jsonb not null default '[]'::jsonb,  -- Full Stripe items
  created_at timestamptz not null default now()
)
*/


// ============================================
// Database: checkout_items Table (NEW)
// ============================================
/*
CREATE TABLE public.checkout_items (
  id bigserial primary key,
  user_id uuid not null references auth.users(id),
  receipt_id bigint not null references public.receipts(id),
  product_id text,                   -- Original product ID
  product_name text not null,         -- Name at time of purchase
  quantity numeric not null,          -- Can be decimal: 1.5
  unit_price_cents bigint not null,   -- Price per unit
  total_price_cents bigint not null,  -- quantity * unit_price_cents
  is_weighted boolean default false,  -- True if item sold by weight
  unit text,                          -- "kg", "lb", "oz", null
  created_at timestamptz not null default now()
)
*/


// ============================================
// Data Flow: From Cart to Database
// ============================================

// 1. Cart item in localStorage:
// {
//   id: "prod-123",
//   name: "Tomato",
//   price: 2.5,            // Per unit price in dollars
//   qty: 2.5,              // Quantity (may be decimal)
//   weighted: true,        // Special handling for weight
//   unit: "kg"
// }

// 2. Gets sent to Stripe checkout as line items:
// {
//   name: "Tomato",
//   quantity: 1,
//   amount_cents: 625,     // 2.5 * 2.5 * 100 = total in cents
//   metadata: {
//     id: "prod-123",
//     weighted: '1',
//     qty: '2.5',
//     unit: 'kg'
//   }
// }

// 3. Stripe returns session details with items:
// {
//   id: "cs_test_...",
//   amount_total: 625,     // Total in cents
//   currency: "usd",
//   line_items: {
//     data: [
//       {
//         description: "Tomato",
//         quantity: 1,
//         amount_cents: 625,
//         price: {
//           metadata: { id: "prod-123", ... }
//         }
//       }
//     ]
//   }
// }

// 4. Gets transformed into checkout_items:
// {
//   user_id: "uuid-xxx",
//   receipt_id: 123,
//   product_id: "prod-123",
//   product_name: "Tomato",
//   quantity: 2.5,                  // Extracted from metadata.qty
//   unit_price_cents: 250,          // 625 / 2.5 = 250
//   total_price_cents: 625,         // Actual charged amount
//   is_weighted: true,              // From metadata.weighted
//   unit: "kg"                      // From metadata.unit
// }

// 5. Email gets formatted as:
// Tomato | 2.5 kg | $2.50 | $6.25


// ============================================
// Query Examples
// ============================================

// Get all receipts for user
/*
SELECT * FROM receipts 
WHERE user_id = current_user_id 
ORDER BY created_at DESC;
*/

// Get all items in a receipt
/*
SELECT * FROM checkout_items 
WHERE receipt_id = 123 
ORDER BY created_at;
*/

// Get total spent by user
/*
SELECT 
  COUNT(*) as purchase_count,
  SUM(amount_total_cents) as total_cents,
  currency
FROM receipts 
WHERE user_id = current_user_id 
GROUP BY currency;
*/

// Get weighted items only
/*
SELECT * FROM checkout_items 
WHERE user_id = current_user_id 
AND is_weighted = true 
ORDER BY created_at DESC;
*/

// Export purchase history
/*
SELECT 
  r.session_id,
  r.amount_total_cents,
  r.currency,
  r.created_at,
  COUNT(c.id) as item_count
FROM receipts r
LEFT JOIN checkout_items c ON r.id = c.receipt_id
WHERE r.user_id = current_user_id
GROUP BY r.id
ORDER BY r.created_at DESC;
*/


// ============================================
// Browser Console Helpers
// ============================================

// Check if all receipts are saved
async function auditCheckouts() {
  const receipts = await window.sb.from('receipts').select('*');
  const items = await window.sb.from('checkout_items').select('*');
  
  console.log('📊 Checkout Audit:');
  console.log(`  Receipts: ${receipts.data?.length || 0}`);
  console.log(`  Items: ${items.data?.length || 0}`);
  
  // Sum up totals
  let totalCents = 0;
  receipts.data?.forEach(r => {
    totalCents += r.amount_total_cents || 0;
  });
  
  console.log(`  Total Spent: $${(totalCents / 100).toFixed(2)}`);
}

// Test email function
async function testSendEmail() {
  const result = await window.sb.functions.invoke('send-checkout-email', {
    body: {
      user_id: 'test-uuid',
      receipt_id: 999,
      user_email: 'test@example.com',
      items: [
        {
          product_name: 'Test Item',
          quantity: 1,
          unit_price_cents: 500,
          total_price_cents: 500,
          is_weighted: false
        }
      ],
      total_cents: 500,
      currency: 'USD'
    }
  });
  console.log('Email test result:', result);
}

// View receipt with items
async function viewReceipt(receiptId) {
  const r = await window.sb.from('receipts')
    .select('*')
    .eq('id', receiptId)
    .single();
  
  const items = await window.sb.from('checkout_items')
    .select('*')
    .eq('receipt_id', receiptId)
    .order('created_at');
  
  console.log('📝 Receipt Details:', {
    receipt: r.data,
    items: items.data?.map(i => ({
      name: i.product_name,
      qty: i.quantity,
      price: `$${(i.unit_price_cents/100).toFixed(2)}`,
      total: `$${(i.total_price_cents/100).toFixed(2)}`
    }))
  });
}


// ============================================
// Error Scenarios & Handling
// ============================================

// Scenario 1: Email service unavailable
// Response: { ok: true, email_sent: false, message: "..." }
// Action: Checkout still succeeds, user informed

// Scenario 2: Database save fails
// Response: None to user, error logged to console
// Action: Checkout still succeeds (non-blocking)

// Scenario 3: RLS policy violation
// Response: Error object from Supabase
// Action: Only user can see their own data (security working)

// Scenario 4: Missing required fields
// Response: { error: "Missing user_email" } (400)
// Action: Email not sent, checkout not affected

// Scenario 5: Stripe webhook not received
// Response: Receipt page works anyway with stored data
// Action: Data saved from session details endpoint

