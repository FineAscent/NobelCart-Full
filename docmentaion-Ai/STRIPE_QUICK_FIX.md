# Quick Fix: Add Stripe Keys to Supabase (2 minutes)

## The Problem
```
❌ STRIPE_SECRET_KEY not configured
❌ Stripe session creation failing
❌ Checkout broken
```

## The Solution
Add 2 environment variables to Supabase Edge Functions.

---

## Step 1: Get Your Stripe Keys (1 minute)

### Go to: https://dashboard.stripe.com/apikeys

You'll see:

```
┌──────────────────────────────────────────┐
│         API Keys                         │
├──────────────────────────────────────────┤
│                                          │
│  Test mode  ◯ ◯ [dropdown]              │
│                                          │
│  Publishable key                         │
│  pk_test_51234567890abcdefghij...      │
│                                          │
│  Secret key                              │
│  sk_test_51234567890abcdefghij...      │
│                                          │
│  Restricted API keys                     │
│  [+ Create restricted key]               │
│                                          │
└──────────────────────────────────────────┘
```

### Copy both keys:
- **Publishable Key**: `pk_test_...`
- **Secret Key**: `sk_test_...`

---

## Step 2: Add to Supabase (1 minute)

### Go to: https://supabase.com/dashboard/project/pkofxkcbdyqcunwjrnnx/settings/functions

Look for **Environment Variables** section.

Click **New Variable** or the **+** button.

### Add first variable:
```
Key:   STRIPE_SECRET_KEY
Value: sk_test_51234567890...  (paste your secret key)
```
Click **Save**

### Add second variable:
```
Key:   STRIPE_PUBLISHABLE_KEY
Value: pk_test_51234567890...  (paste your publishable key)
```
Click **Save**

---

## Step 3: Wait for Update (10 seconds)

Edge functions auto-update after you save variables. Just wait a moment.

---

## Step 4: Test

Go back to your app and try checkout again.

**Should see:**
- ✅ QR code appears
- ✅ "Scan to pay" message
- ✅ No 502 errors

**If still broken:**
- Refresh your browser
- Wait another 10 seconds
- Check function logs for errors

---

## ✅ Done!

Stripe is now configured. Your checkout should work!

Next: Follow [MANUAL_DEPLOYMENT_GUIDE.md](MANUAL_DEPLOYMENT_GUIDE.md) to complete the checkout data persistence setup.

---

**Need the full guide?** See [STRIPE_SETUP_GUIDE.md](STRIPE_SETUP_GUIDE.md)
