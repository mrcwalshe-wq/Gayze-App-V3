// Mirror of the deployed `webrtc-ice-servers` function (v6), committed for traceability.
// It was previously only in the Supabase project. Behaviour is unchanged.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TURN_KEY_ID = Deno.env.get("CLOUDFLARE_TURN_KEY_ID");
const TURN_API_TOKEN = Deno.env.get("CLOUDFLARE_TURN_API_TOKEN");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!TURN_KEY_ID || !TURN_API_TOKEN) {
    return new Response(JSON.stringify({ error: "TURN service is not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(TURN_KEY_ID)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TURN_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ttl: 86400,
        }),
      },
    );

    const body = await response.text();

    if (!response.ok) {
      console.error("[GAYZE TURN] Cloudflare credential generation failed:", response.status, body);
      return new Response(JSON.stringify({ error: "TURN credential generation failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(body, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[GAYZE TURN] Unexpected error:", error);
    return new Response(JSON.stringify({ error: "TURN service unavailable" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
