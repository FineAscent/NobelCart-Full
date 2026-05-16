// qr-cart-approve
// Called by the mobile app (authenticated user) to approve a kiosk QR session.
// Body: { cart_id: string }
// Auth: Bearer <user JWT from app>
// Effect: generates a magic-link token for the user and writes it into
//         cart_qr_sessions, flipping status -> approved so the kiosk
//         Realtime subscription fires and calls verifyOtp to sign in.

// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// @ts-ignore
const SUPABASE_URL: string = Deno.env.get("SUPABASE_URL") ?? "";
// @ts-ignore
const SUPABASE_SERVICE_ROLE_KEY: string = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// @ts-ignore
const SUPABASE_ANON_KEY: string = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function badRequest(msg: string, status = 400) {
  return new Response(
    JSON.stringify({ error: msg }),
    { status, headers: { "content-type": "application/json", ...corsHeaders } }
  );
}

serve(async (req: any) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return badRequest("Method not allowed", 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return badRequest("Missing authorization header", 401);
  }

  try {
    // Verify the calling user via their JWT (the app user)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return badRequest("Unauthorized", 401);
    }
    if (!user.email) {
      return badRequest("User account has no email address", 400);
    }

    // Parse request body
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch (_) {}
    const cart_id = String(body?.cart_id ?? "").trim();
    if (!cart_id) {
      return badRequest("cart_id is required");
    }

    // Admin client — bypasses RLS for the update
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Confirm a non-expired pending session exists for this cart
    const { data: session, error: selectErr } = await admin
      .from("cart_qr_sessions")
      .select("id")
      .eq("cart_id", cart_id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (selectErr) {
      return badRequest("DB error: " + selectErr.message, 500);
    }
    if (!session) {
      return badRequest("No active pending QR session for this cart", 404);
    }

    // Generate a magic link token for this user (admin privilege required)
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: user.email,
    });

    if (linkErr || !linkData?.properties?.hashed_token) {
      return badRequest(
        "Failed to generate login token: " + (linkErr?.message ?? "unknown"),
        500
      );
    }

    const token_hash = linkData.properties.hashed_token;

    // Approve the most recent pending session for this cart
    const { error: updateErr } = await admin
      .from("cart_qr_sessions")
      .update({
        status: "approved",
        user_id: user.id,
        token_hash,
      })
      .eq("id", session.id);

    if (updateErr) {
      return badRequest("Failed to approve session: " + updateErr.message, 500);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { "content-type": "application/json", ...corsHeaders } }
    );

  } catch (e: any) {
    return badRequest(e?.message ?? "Internal server error", 500);
  }
});
