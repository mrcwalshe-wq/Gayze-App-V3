/** Place search proxy. See handler.ts. verify_jwt is on; the handler also verifies the token. */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createPlaceSearchHandler } from './handler.ts';

const anon = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(createPlaceSearchHandler({
  async authenticate(token) {
    const { data, error } = await anon.auth.getUser(token);
    return error || !data.user ? null : data.user.id;
  },
}));
