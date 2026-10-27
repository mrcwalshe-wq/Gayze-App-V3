import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Starts a Yoti age check (over 18) for the signed-in member and returns the Yoti URL to open.
// Secrets (set in Supabase > Edge Functions > Secrets): YOTI_API_KEY, YOTI_SDK_ID.
// Optional: YOTI_APP_URL (defaults to https://gayze.co.uk), YOTI_FACE_THRESHOLD (default 25).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response(405, { error: "Method not allowed." });

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return response(401, { error: "Sign in to verify your age." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const yotiKey = Deno.env.get("YOTI_API_KEY");
  const yotiSdkId = Deno.env.get("YOTI_SDK_ID");
  if (!supabaseUrl || !serviceRoleKey || !yotiKey || !yotiSdkId) {
    return response(500, { error: "Age verification is not configured yet." });
  }
  const appUrl = (Deno.env.get("YOTI_APP_URL") || "https://gayze.co.uk").replace(/\/+$/, "");
  const faceThreshold = Number(Deno.env.get("YOTI_FACE_THRESHOLD") || 25);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(authorization.slice("Bearer ".length));
  const user = authData.user;
  if (authError || !user) return response(401, { error: "Your session is invalid. Sign in again." });

  let platform = "web";
  try {
    const body = await req.json();
    if (body?.platform === "native") platform = "native";
  } catch { /* empty body is fine */ }

  const { data: existing } = await admin
    .from("age_verifications")
    .select("status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing?.status === "verified") return response(200, { status: "verified" });

  // Native: Yoti returns to a static page telling the member to go back to the app.
  // Web: Yoti returns straight to the app, which then checks the result.
  const callbackUrl = platform === "native" ? `${appUrl}/age-done.html` : `${appUrl}/?age_check=1`;

  const yotiResponse = await fetch("https://age.yoti.com/api/v1/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${yotiKey}`,
      "Content-Type": "application/json",
      "Yoti-SDK-Id": yotiSdkId,
    },
    body: JSON.stringify({
      type: "OVER",
      ttl: 900,
      callback: { url: callbackUrl, auto: true },
      cancel_url: appUrl,
      synchronous_checks: true,
      retry_enabled: true,
      // Face estimate must clear a buffer above 18 (default 25); otherwise Yoti offers ID instead.
      age_estimation: { allowed: true, threshold: faceThreshold },
      digital_id: { allowed: true, threshold: 18 },
      doc_scan: { allowed: true, threshold: 18 },
    }),
  });

  if (!yotiResponse.ok) {
    console.error("[age-verify-start] Yoti session failed", yotiResponse.status, await yotiResponse.text().catch(() => ""));
    return response(502, { error: "Could not start age verification. Try again shortly." });
  }
  const session = await yotiResponse.json();
  const sessionId = String(session?.id ?? "");
  if (!sessionId) return response(502, { error: "Could not start age verification. Try again shortly." });

  const { error: saveError } = await admin.from("age_verifications").upsert({
    user_id: user.id,
    provider: "yoti",
    session_id: sessionId,
    status: "pending",
    method: null,
    updated_at: new Date().toISOString(),
  });
  if (saveError) {
    console.error("[age-verify-start] save failed", saveError.message);
    return response(500, { error: "Could not start age verification." });
  }

  const url = `https://age.yoti.com?sessionId=${encodeURIComponent(sessionId)}&sdkId=${encodeURIComponent(yotiSdkId)}&locale=en-GB`;
  return response(200, { status: "pending", url });
});
