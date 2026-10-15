import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
  if (!authorization?.startsWith("Bearer ")) return response(401, { error: "Sign in to delete your account." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return response(500, { error: "Account deletion is not configured." });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authorization.slice("Bearer ".length);
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const user = authData.user;
  if (authError || !user) return response(401, { error: "Your session is invalid. Sign in again." });

  try {
    // Remove only objects under this account's own storage prefix.
    // This covers current profile photos and legacy Photos uploads.
    async function listOwnedFiles(bucket: string, folder: string): Promise<string[]> {
      const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000, offset: 0 });
      if (error) throw new Error(`Could not inspect account files in ${bucket}: ${error.message}`);
      const files: string[] = [];
      for (const item of data ?? []) {
        const path = `${folder}/${item.name}`;
        if (item.id === null) files.push(...await listOwnedFiles(bucket, path));
        else files.push(path);
      }
      return files;
    }

    for (const bucket of ["profile-photos", "Photos"]) {
      const files = await listOwnedFiles(bucket, user.id).catch((error) => {
        // A missing legacy bucket is harmless; a current profile bucket error is not.
        if (bucket === "Photos" && /not found|does not exist/i.test(String(error))) return [];
        throw error;
      });
      for (let i = 0; i < files.length; i += 100) {
        const { error } = await admin.storage.from(bucket).remove(files.slice(i, i + 100));
        if (error) throw new Error(`Could not remove account files: ${error.message}`);
      }
    }

    // Remove the auth identity, then erase the profile row. Profile-owned records
    // use cascading foreign keys; audit/report retention follows the database rules.
    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteAuthError) throw new Error(`Could not delete the authentication account: ${deleteAuthError.message}`);

    const { error: deleteProfileError } = await admin.from("profiles").delete().eq("id", user.id);
    if (deleteProfileError) {
      console.error("[delete-account] profile cleanup failed after auth deletion", deleteProfileError.message);
      return response(500, { error: "Your sign-in account was deleted, but profile cleanup needs administrator attention. Contact gayze.co.uk@gmail.com." });
    }

    return response(200, { success: true });
  } catch (error) {
    console.error("[delete-account]", error instanceof Error ? error.message : error);
    return response(500, { error: error instanceof Error ? error.message : "Account deletion failed. Contact gayze.co.uk@gmail.com." });
  }
});
