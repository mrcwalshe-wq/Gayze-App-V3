import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Reads the result of the member's latest Yoti session and records the outcome.
// The client never decides whether someone is verified: only this function can mark a member verified.

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

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(authorization.slice("Bearer ".length));
  const user = authData.user;
  if (authError || !user) return response(401, { error: "Your session is invalid. Sign in again." });

  const { data: row } = await admin
    .from("age_verifications")
    .select("status, session_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (row?.status === "verified") return response(200, { status: "verified" });
  if (!row?.session_id) return response(200, { status: "none" });

  const yotiResponse = await fetch(
    `https://age.yoti.com/api/v1/sessions/${encodeURIComponent(row.session_id)}/result`,
    {
      headers: {
        Authorization: `Bearer ${yotiKey}`,
        "Content-Type": "application/json",
        "Yoti-SDK-Id": yotiSdkId,
      },
    },
  );
  if (!yotiResponse.ok) {
    console.error("[age-verify-check] Yoti result failed", yotiResponse.status);
    return response(502, { error: "Could not read the age check result. Try again." });
  }
  const result = await yotiResponse.json();
  const providerStatus = String(result?.status ?? "UNKNOWN");

  // COMPLETE = passed the threshold. FAIL = checked and not over 18. Anything else is not a pass.
  if (providerStatus === "COMPLETE") {
    await admin.from("age_verifications").update({
      status: "verified",
      method: result?.method ? String(result.method) : null,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", user.id);
    return response(200, { status: "verified" });
  }
  if (providerStatus === "FAIL") {
    await admin.from("age_verifications").update({
      status: "failed",
      method: result?.method ? String(result.method) : null,
      updated_at: new Date().toISOString(),
    }).eq("user_id", user.id);
    return response(200, { status: "failed", providerStatus });
  }
  return response(200, { status: "pending", providerStatus });
});
