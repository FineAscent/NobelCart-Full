# Complete Data Flow Diagram

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USER BROWSER                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┐      ┌──────────────────┐                   │
│  │  index.html      │      │  cabinet.html    │                   │
│  │  category.html   │      │  checkout.html   │                   │
│  │  Create account  │      │  receipt.html    │                   │
│  └────────┬─────────┘      └────────┬─────────┘                   │
│           │                         │                              │
│           └─────────────┬───────────┘                              │
│                         ▼                                           │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │              site.js (Core Application Logic)               │  │
│  │                                                             │  │
│  │  Cart Management:                                          │  │
│  │  ├─ loadCart() / saveCart()                               │  │
│  │  ├─ addToCart() / removeFromCart()                        │  │
│  │  └─ renderCart()                                          │  │
│  │                                                             │  │
│  │  Product Management:                                       │  │
│  │  ├─ fetchProducts()                                        │  │
│  │  ├─ fetchProductsByIds()                                  │  │
│  │  └─ renderProductsToGrid()                                │  │
│  │                                                             │  │
│  │  Checkout Flow:                                            │  │
│  │  ├─ startCheckout()  ─────────────┐                      │  │
│  │  ├─ Stripe.js                     │                      │  │
│  │  └─ pollStatus()                  │                      │  │
│  │                                   │                      │  │
│  │  Receipt Processing (ENHANCED):  │                      │  │
│  │  ├─ fetchDetails(sessionId) ◄────┘                      │  │
│  │  │  └─ Get session from Stripe                           │  │
│  │  │                                                         │  │
│  │  ├─ Save to receipts table (existing)                    │  │
│  │  │                                                         │  │
│  │  ├─ Save to checkout_items table ◄─── NEW               │  │
│  │  │  └─ Extract product details                           │  │
│  │  │  └─ Calculate unit prices                             │  │
│  │  │  └─ Map weighted items                                │  │
│  │  │                                                         │  │
│  │  ├─ Call send-checkout-email() ◄─── NEW                │  │
│  │  │  └─ Pass items & user email                           │  │
│  │  │                                                         │  │
│  │  └─ fetchUserReceipts() ◄─── NEW HELPER                 │  │
│  │  └─ fetchCheckoutItemsForReceipt() ◄─── NEW HELPER      │  │
│  │  └─ fetchUserCheckoutHistory() ◄─── NEW HELPER          │  │
│  │                                                             │  │
│  └─────────────────┬───────────────────────────────────────┘  │
│                    │                                            │
│  ┌────────────────▼──────────────────┐                        │
│  │    Supabase JavaScript SDK        │                        │
│  │    window.sb                      │                        │
│  └────────────────┬──────────────────┘                        │
│                    │                                            │
│  ┌────────────────▼──────────────────┐                        │
│  │    localStorage (CART_KEY)        │                        │
│  │    sessionStorage (Sessions)      │                        │
│  └────────────────┬──────────────────┘                        │
│                    │                                            │
│  ┌────────────────▼──────────────────────────────────────┐   │
│  │         Third-Party Services                          │   │
│  │  ┌──────────────────┐    ┌──────────────────────┐   │   │
│  │  │   STRIPE API     │    │   QRCode API         │   │   │
│  │  │                  │    │   api.qrserver.com   │   │   │
│  │  │ • Create session │    └──────────────────────┘   │   │
│  │  │ • Get session    │                              │   │
│  │  │ • Payment        │    ┌──────────────────────┐   │   │
│  │  │   processing     │    │   RESEND (Email)     │   │   │
│  │  │                  │    │                      │   │   │
│  │  └──────────────────┘    │ • Optional email     │   │   │
│  │                          │   service            │   │   │
│  │                          └──────────────────────┘   │   │
│  └────────────────┬──────────────────────────────────┘   │
│                   │                                       │
└───────────────────┼───────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  SUPABASE PROJECT (Backend)                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │              PostgreSQL Database                            │  │
│  │                                                             │  │
│  │  ┌─────────────────────────────────────────────────────┐   │  │
│  │  │  auth.users (Supabase Auth)                        │   │  │
│  │  │  ├─ id (uuid, primary key)                         │   │  │
│  │  │  ├─ email                                          │   │  │
│  │  │  └─ user_metadata                                 │   │  │
│  │  └──────────┬──────────────────────────────────────────┘   │  │
│  │             │                                              │  │
│  │  ┌──────────▼──────────────────────────────────────────┐   │  │
│  │  │  receipts (Existing)                               │   │  │
│  │  │  ├─ id (bigint, PK)                                │   │  │
│  │  │  ├─ user_id (uuid, FK) ──┐                        │   │  │
│  │  │  ├─ session_id (unique)   │                        │   │  │
│  │  │  ├─ amount_total_cents    │                        │   │  │
│  │  │  ├─ currency              │                        │   │  │
│  │  │  ├─ items (jsonb)         │                        │   │  │
│  │  │  └─ created_at            │                        │   │  │
│  │  └──────────┬─────────────────┼────────────────────────┘   │  │
│  │             │                 │                            │  │
│  │  ┌──────────▼─────────────────┼─────────────────────────┐  │  │
│  │  │  checkout_items (NEW) ◄────┘                        │  │  │
│  │  │  ├─ id (bigint, PK)                                 │  │  │
│  │  │  ├─ user_id (uuid, FK)                              │  │  │
│  │  │  ├─ receipt_id (bigint, FK) ─────┐                  │  │  │
│  │  │  ├─ product_id                    │                  │  │  │
│  │  │  ├─ product_name                  │                  │  │  │
│  │  │  ├─ quantity (numeric, decimal)   │ Individual line  │  │  │
│  │  │  ├─ unit_price_cents              │ items from each  │  │  │
│  │  │  ├─ total_price_cents             │ checkout        │  │  │
│  │  │  ├─ is_weighted (boolean)         │                  │  │  │
│  │  │  ├─ unit (text: kg, lb, oz, etc) │                  │  │  │
│  │  │  └─ created_at ◄─────────────────┼── Timestamp     │  │  │
│  │  │                                   │                  │  │  │
│  │  │  Indexes (for performance):       │                  │  │  │
│  │  │  ├─ idx_user_id (for queries)     │                  │  │  │
│  │  │  ├─ idx_receipt_id (FK speed)     │                  │  │  │
│  │  │  └─ idx_created_at (ordering)     │                  │  │  │
│  │  │                                   │                  │  │  │
│  │  │  RLS Policies:                   │                  │  │  │
│  │  │  ├─ insert: user owns (auth.uid)  │                  │  │  │
│  │  │  ├─ select: user owns             │                  │  │  │
│  │  │  └─ update: user owns             │                  │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                           │                                        │
│  ┌─────────────────────────▼──────────────────────────────────┐  │
│  │              Edge Functions (Deno Runtime)                 │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────────┐ │  │
│  │  │  send-checkout-email (NEW)                           │ │  │
│  │  │                                                      │ │  │
│  │  │  Input:                                              │ │  │
│  │  │  ├─ user_email                                       │ │  │
│  │  │  ├─ items (checkout_items data)                      │ │  │
│  │  │  ├─ total_cents                                      │ │  │
│  │  │  └─ currency                                         │ │  │
│  │  │                                                      │ │  │
│  │  │  Process:                                            │ │  │
│  │  │  ├─ Build HTML template                              │ │  │
│  │  │  ├─ Format itemized list                             │ │  │
│  │  │  ├─ Call Resend API (if RESEND_API_KEY set)         │ │  │
│  │  │  └─ Return status                                    │ │  │
│  │  │                                                      │ │  │
│  │  │  Output:                                             │ │  │
│  │  │  ├─ Email sent (if service available)                │ │  │
│  │  │  ├─ Error handling (graceful degradation)            │ │  │
│  │  │  └─ Success response                                 │ │  │
│  │  └──────────────────────────────────────────────────────┘ │  │
│  │                                                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

## Detailed Data Transformation Pipeline

```
1. CART (localStorage)
   {
     id: "prod-123",
     name: "Tomato",
     price: 2.50,
     qty: 2.5,
     weighted: true,
     unit: "kg"
   }
   │
   ├─ User clicks "Checkout"
   │
   └─► STRIPE LINE ITEM
       {
         name: "Tomato",
         quantity: 1,
         amount_cents: 625,     (2.5 * 2.5 * 100)
         metadata: {
           id: "prod-123",
           weighted: '1',
           qty: '2.5',
           unit: 'kg'
         }
       }
       │
       ├─ Payment processed
       │
       └─► STRIPE SESSION DETAILS
           {
             id: "cs_test_...",
             amount_total: 625,
             currency: "usd",
             line_items: {
               data: [{ ... }]
             }
           }
           │
           ├─ Receipt page fetches details
           │
           └─► CHECKOUT_ITEM (Database record)
               {
                 user_id: "uuid-...",
                 receipt_id: 123,
                 product_id: "prod-123",
                 product_name: "Tomato",
                 quantity: 2.5,
                 unit_price_cents: 250,
                 total_price_cents: 625,
                 is_weighted: true,
                 unit: "kg",
                 created_at: "2024-01-24T10:30:00Z"
               }
               │
               ├─ Item saved to Supabase
               │
               └─► EMAIL RECEIPT
                   From: noreply@nobelcart.com
                   To: user@example.com
                   Subject: Receipt Confirmation - Order #123
                   
                   Body includes:
                   ├─ Itemized list
                   │  └─ Tomato | 2.5 kg | $2.50 | $6.25
                   ├─ Total: $6.25
                   ├─ Date & Time
                   └─ Receipt ID
```

## Request/Response Flow

```
CLIENT BROWSER                    SUPABASE              STRIPE API
    │                                │                      │
    ├─ startCheckout() ──────────────┼─────────────────────►│
    │  (cart items)                  │                      │
    │                                │  invoke function     │
    │                                │◄─────────────────────┤
    │                                │  (session created)   │
    │                                │                      │
    │◄──────────────────────────────────────────────────────┤
    │  (checkout URL / QR code)      │                      │
    │                                │                      │
    │  [User scans QR, pays online]                         │
    │                                │                      │
    │  [Payment complete]            │                      │
    │◄───────────────────────────────┼──────────────────────┤
    │  (redirect to receipt.html)    │                      │
    │                                │                      │
    ├─ fetchDetails(sessionId) ──────┼────────────────────►│
    │  (retrieve session)            │                      │
    │                                │                      │
    │                                │  (fetch)             │
    │                                │◄────────────────────┤
    │◄──────────────────────────────────────────────────────┤
    │  (session details)             │                      │
    │                                │                      │
    ├─ Save receipt ────────────────►│                      │
    │  (receipts table)              │                      │
    │                                │                      │
    ├─ Save checkout items ────────►│                      │
    │  (checkout_items table)        │                      │
    │                                │                      │
    ├─ invoke send-checkout-email ──►│                      │
    │  (items, total, email)         │                      │
    │                                │                      │
    │                        invoke function                 │
    │                                │                      │
    │                        call Resend API                 │
    │                                ├──────────────────────►
    │                                │  (POST /emails)      │
    │                                │◄──────────────────────
    │                                │  (email ID)          │
    │                                │                      │
    │◄────────────────────────────────────────────────────────
    │  (response: email sent)        │                      │
    │                                │                      │
    ├─ Show thank you page          │                      │
    ├─ Clear cart                   │                      │
    ├─ Sign out                     │                      │
    └─ Redirect to signin           │                      │
```

## Security & Data Isolation

```
USER A                          SUPABASE                      USER B
  │                               │                              │
  ├─ Sign in                      │                              │
  │                               │                              │
  ├─ Add items & checkout ───────►│ receipts                     │
  │                               │ ├─ user_id = A               │
  │                               │ └─ RLS policy:               │
  │                               │    auth.uid() = A ✓         │
  │                               │                              │
  ├─ Can read own data            │                              │
  │  (receipts where              │                              │
  │   user_id = A) ───────────────┼──► Query succeeds ✓         │
  │                               │                              │
  │                               │◄──────────────────┐          │
  │                               │   Items saved     │          │
  │                               │   (checkout_items)│          │
  │                               │                  ├──► Signs in
  │                               │                              │
  ├─ Try to query user B data     │                              │
  │  (where user_id = B)          │                              │
  │  (but auth.uid() = A) ────────┼──► Query fails ✗            │
  │                               │    (RLS policy              │
  │                               │     violation)              │
  │                               │                              │
  └─ Cannot access ─ ─ ─ ─ ─ ─ ─►│◄─ BLOCKED                 │
                                  │   by RLS                   │
                                  │                              │
                                  └──────────────────┬──► Can only
                                                     │  see own
                                                     │  receipts
                                                     │
                                                     └─ Secure ✓
```

## Failure & Recovery

```
┌─ Payment succeeds ──► Receipt page ──┐
│                                      ▼
│                          Save receipt?
│                              │
│                      ┌───────┴───────┐
│                      ▼               ▼
│                    YES              NO
│                      │               │
│                      ▼               ▼
│              Save items in      Log error
│              checkout_items     (non-fatal)
│                      │
│                      ▼
│             Send email?
│                      │
│             ┌────────┴────────┐
│             ▼                 ▼
│        YES (API key)      NO (optional)
│             │                 │
│             ▼                 ▼
│       Call Resend API    Log message
│             │           (email not configured)
│             │
│        ┌────┴─────────┐
│        ▼              ▼
│      OK             ERROR
│       │              │
│       ▼              ▼
│   Email sent    Graceful error
│       │         (but data saved)
│       │              │
│       └──────┬───────┘
│              ▼
│       Show thank you
│       Clear cart
│       Redirect to signin
│
└─ Data ALWAYS saved
   even if email fails
```

This architecture ensures:
✅ Data persistence (Supabase)
✅ Email notifications (Resend)
✅ Security (RLS policies)
✅ Graceful degradation (email optional)
✅ Scalability (indexed queries)
