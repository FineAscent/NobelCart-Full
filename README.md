# NobelCart Full Setup

## Security & Configuration

### Stripe Setup
This project uses Supabase Edge Functions to securely handle Stripe Checkout sessions.

To configure your Stripe keys securely:

1. **Get your keys** from the [Stripe Dashboard](https://dashboard.stripe.com/apikeys).
   - **Publishable Key**: `pk_test_...` or `pk_live_...`
   - **Secret Key**: `sk_test_...` or `sk_live_...`

2. **Set Supabase Secrets**:
   Run the following commands using the [Supabase CLI](https://supabase.com/docs/guides/cli) to set your production secrets. This ensures your keys are never exposed in client-side code or git commits.

   ```bash
   supabase secrets set STRIPE_PUBLISHABLE_KEY=pk_test_...
   supabase secrets set STRIPE_SECRET_KEY=sk_test_...
   ```

   Or, you can set these in the Supabase Dashboard under **Project Settings > Edge Functions > Secrets**.

### Environment Variables
- `STRIPE_PUBLISHABLE_KEY`: Used by the frontend (fetched securely via the backend) to initialize the embedded checkout.
- `STRIPE_SECRET_KEY`: Used by the backend `stripe-create-session` function to create checkout sessions.

### Local Development
If running locally, create a `.env` file in the `supabase/functions` folder (or root, depending on your setup) with:
```
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
```
*Note: `.env` is git-ignored to prevent accidental leaks.*
