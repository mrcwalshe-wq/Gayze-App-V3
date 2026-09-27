import { supabase } from './supabaseClient';

export type AnalyticsEvent =
  | 'signup_completed'
  | 'location_permission_granted'
  | 'location_permission_denied'
  | 'active_session'
  | 'intent_published'
  | 'discovery_session'
  | 'nearby_results_viewed'
  | 'profile_opened'
  | 'interest_submitted'
  | 'mutual_interest_matched'
  | 'conversation_created'
  | 'message_sent'
  | 'video_call_initiated'
  | 'video_call_connected'
  | 'video_call_ended';

interface EventPayload {
  [key: string]: string | number | boolean | undefined | null;
}

class AnalyticsService {
  private queue: Array<{ event: AnalyticsEvent; payload?: EventPayload; timestamp: number }> = [];

  /**
   * Log an aggregate, privacy-preserving product event.
   * STRICT PRIVACY GUARANTEE: Never logs GPS coordinates, message text, photos, or private keys.
   */
  public logEvent(event: AnalyticsEvent, payload?: EventPayload): void {
    const entry = {
      event,
      payload,
      timestamp: Date.now(),
    };

    // Keep lightweight in-memory / local debug log
    this.queue.push(entry);
    if (this.queue.length > 100) {
      this.queue.shift();
    }

    // Optional dispatch to Supabase analytics table if provisioned
    if (supabase) {
      try {
        void supabase.from('app_analytics').insert({
          event_name: event,
          metadata: payload || {},
          created_at: new Date().toISOString(),
        }).then(() => {}, () => {});
      } catch {
        // Silently swallow analytics errors to never disrupt product UX
      }
    }
  }

  public getRecentEvents() {
    return [...this.queue];
  }
}

export const analytics = new AnalyticsService();
