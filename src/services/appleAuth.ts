/** Helpers for native Sign in with Apple. Apple signs a hash of the nonce into its token; Supabase checks the raw nonce. */
export function randomNonce(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Apple only sends the name the first time a person signs in. */
export function appleDisplayName(given?: string | null, family?: string | null): string | null {
  const name = [given, family].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
  return name || null;
}

export function isAppleCancel(error: unknown): boolean {
  const msg = String((error as { message?: string; code?: string } | null)?.message ?? error ?? '').toLowerCase();
  const code = String((error as { code?: string } | null)?.code ?? '').toLowerCase();
  return msg.includes('cancel') || code === 'cancelled' || msg.includes('1001');
}
