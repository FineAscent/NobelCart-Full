# Fix Stripe Integration - Setup Guide

## Problem

Your Stripe integration is failing because the `STRIPE_SECRET_KEY` environment variable is not configured in Supabase Edge Functions.

### Error Messages You're Seeing
```
[Error] Failed to load resource: the server responded with a status of 502 (Bad Gateway) 
FunctionsHttpError: Edge Function returned a non-2xx status code
```

This means the `stripe-create-session` edge function is running but failing because Stripe is not configured.

---

## Solution

### Step 1: Get Your Stripe Keys

1. Go to **Stripe Dashboard**: https://dashboard.stripe.com
2. In the left menu, go to **Developers** → **API Keys**
3. You'll see two keys:
   - **Publishable Key** - starts with `pk_live_` or `pk_test_`
   - **Secret Key** - starts with `sk_live_` or `sk_test_`

**Note:** If you see "TEST MODE" toggle, make sure you're using TEST keys for development:
- Test Publishable: `pk_test_...`
- Test Secret: `sk_test_...`

### Step 2: Add to Supabase Environment Variables

1. Go to **Supabase Dashboard**: https://supabase.com/dashboard/project/pkofxkcbdyqcunwjrnnx/settings/functions

2. Click **Environment Variables** (or look in Settings)

3. Add these variables:

| Key | Value |
|-----|-------|
| `STRIPE_SECRET_KEY` | `sk_test_xxxxx...` (your test secret key) |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_xxxxx...` (your test publishable key) |

**Example:**
```
STRIPE_SECRET_KEY = sk_test_51234567890abcdefghijklmnop
STRIPE_PUBLISHABLE_KEY = pk_test_51234567890abcdefghijklmnop
```

4. Click **Save** for each variable

5. **Important:** After saving, the edge function will auto-update. Wait ~10 seconds.

### Step 3: Verify Configuration

In Supabase Dashboard, go to **Functions** and check `stripe-create-session`:
- Status should be **Active** (green)
- No error messages

### Step 4: Test Stripe Connection

```javascript
// In browser console on your app:
const result = await startCheckout({ returnSession: true });
console.log('Stripe result:', result);
```

Expected output:
```javascript
{
  id: "cs_test_...",
  url: "https://checkout.stripe.com/...",
  status: "open",
  ...
}
```

If you see `id` and `url`, Stripe is working! ✅

---

## Using Test vs Live Keys

### For Development/Testing (Recommended)
Use **test keys** (`sk_test_`, `pk_test_`):
- No real charges
- Use test card: `4242 4242 4242 4242`
- Perfect for building and testing

### For Production
Use **live keys** (`sk_live_`, `pk_live_`):
- Real charges
- Real customer data
- More restricted access

### How to Switch
Just replace the environment variables and save. Edge functions auto-update.

---

## Test Cards for Stripe

Use these with test keys to test different scenarios:

| Scenario | Card Number | Expiry | CVC |
|----------|-------------|--------|-----|
| Success | `4242 4242 4242 4242` | Any future | Any 3 digits |
| Decline | `4000 0000 0000 0002` | Any future | Any 3 digits |
| 3D Secure | `4000 0025 0000 3155` | Any future | Any 3 digits |

---

## Troubleshooting

### Still getting 502 error?
1. Check that `STRIPE_SECRET_KEY` is saved (not empty)
2. Wait 15 seconds after saving
3. Refresh your app
4. Check function logs in Supabase Dashboard

### Getting CORS error (403)?
This means the API fallback is trying to use AWS Lambda, which is also not configured. You have two options:

**Option A: Use Supabase Edge Functions Only** (Recommended)
- Keep using `stripe-create-session` edge function
- Make sure `STRIPE_SECRET_KEY` is set
- This should work fine

**Option B: Configure AWS API**
- More complex setup
- Only needed if edge function approach won't work

**Recommendation:** Use Option A. Your edge function is already deployed and ready.

### Function shows as "Inactive"?
1. Go to **Functions** in Supabase
2. Click `stripe-create-session`
3. Check for error messages in the logs
4. Verify `STRIPE_SECRET_KEY` is not empty

---

## Complete Setup Checklist

- [ ] Logged into Stripe Dashboard
- [ ] Found your test Secret Key (`sk_test_...`)
- [ ] Found your test Publishable Key (`pk_test_...`)
- [ ] Added `STRIPE_SECRET_KEY` to Supabase environment variables
- [ ] Added `STRIPE_PUBLISHABLE_KEY` to Supabase environment variables
- [ ] Waited 10+ seconds for functions to update
- [ ] Tested checkout in app
- [ ] Got successful Stripe session with ID and URL
- [ ] Ready to test payment

---

## Next: Test Complete Checkout Flow

Once Stripe is working:

1. ✅ Add items to cart
2. ✅ Click checkout
3. ✅ See QR code (or payment form)
4. ✅ Complete payment with test card
5. ✅ Receipt page loads
6. ✅ Check Supabase:
   ```sql
   SELECT * FROM receipts ORDER BY created_at DESC LIMIT 1;
   SELECT * FROM checkout_items ORDER BY created_at DESC LIMIT 1;
   ```
7. ✅ Check email (if configured)

---

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| "Edge Function returned non-2xx" | `STRIPE_SECRET_KEY` not set | Set it in Supabase env vars |
| Function still shows error after saving | Cache issue | Wait 15 seconds, refresh page |
| CORS 403 error | Using AWS API fallback | Make sure edge function env vars are set |
| Invalid API key error | Wrong key format | Verify it starts with `sk_test_` or `sk_live_` |
| Stripe dashboard showing nothing | Wrong account | Make sure you're in the right Stripe account |

---

## Help & Links

- **Stripe Keys**: https://dashboard.stripe.com/apikeys
- **Supabase Functions**: https://supabase.com/dashboard/project/pkofxkcbdyqcunwjrnnx/functions
- **Supabase Env Vars**: https://supabase.com/dashboard/project/pkofxkcbdyqcunwjrnnx/settings/functions
- **Stripe Docs**: https://stripe.com/docs/keys

---

## Ready?

Once you set the Stripe keys:

1. Stripe integration works ✅
2. Checkout creates sessions ✅
3. Checkout data saves to Supabase ✅ (already implemented)
4. Receipt emails send ✅ (already implemented)

**You're almost there!** Just need those two Stripe env vars. 🚀
