import { supabase } from './supabaseClient';

/** Reasons a member can choose. Stored as the `reason` text; reviewed in the admin console. */
export const REPORT_REASONS = [
  'Harassment or abuse',
  'Spam or scam',
  'Fake profile or impersonation',
  'Inappropriate photos or content',
  'Underage or safety concern',
  'Something else',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** File a report against another member. The reports table is RLS-protected (own reports only). */
export async function submitReport(input: {
  reportedId: string;
  conversationId?: string | null;
  reason: ReportReason;
  details?: string;
}): Promise<void> {
  if (!supabase) throw new Error('Reporting requires the live account service.');
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('Sign in to report this user.');
  if (!UUID.test(input.reportedId) || input.reportedId === auth.user.id) throw new Error('You cannot report this account.');
  if (!REPORT_REASONS.includes(input.reason)) throw new Error('Choose a reason for your report.');
  const { error } = await supabase.from('reports').insert({
    reporter_id: auth.user.id,
    reported_id: input.reportedId,
    conversation_id: input.conversationId && UUID.test(input.conversationId) ? input.conversationId : null,
    reason: input.reason,
    details: input.details?.trim().slice(0, 1000) || null,
    status: 'open',
  });
  if (error) throw new Error(error.message || 'Could not send your report. Try again.');
}
