import { supabase } from './supabaseClient';
import { RealtimeRecovery, requireRealtimeSession, type ChatConnectionState } from './realtimeRecovery';

/**
 * Enhanced presence tracking that includes both online status and last seen timestamps.
 * Uses Supabase Realtime presence system with custom state tracking.
 */

export interface PresenceState {
  user_id: string;
  display_name?: string;
  online_at: string; // ISO timestamp when user came online
  last_seen_at?: string; // ISO timestamp when user was last seen
  status: 'online' | 'offline' | 'away';
}

export interface UserPresence {
  userId: string;
  displayName?: string;
  isOnline: boolean;
  lastSeenAt?: string;
  status: 'online' | 'offline' | 'away';
}

/**
 * Initialize presence tracking for the current user and subscribe to other users' presence.
 * This provides both real-time online status and last seen information.
 */
export function initEnhancedPresence(
  userId: string,
  displayName: string,
  onPresenceUpdate: (presenceMap: Map<string, UserPresence>) => void,
  visible: boolean = true,
  status: 'online' | 'away' = 'online'
): () => void {
  if (!supabase) return () => undefined;

  const client = supabase;
  let channel: import('@supabase/supabase-js').RealtimeChannel | null = null;
  const presenceMap = new Map<string, UserPresence>();

  const recovery = new RealtimeRecovery({
    client, userId, topic: 'gayze-presence-v2', syncWhileJoining: false,
    channelOptions: { config: { presence: { key: userId } } },
    session: (signal) => requireRealtimeSession(client, userId, signal),
    build: (next, current) => {
      channel = next;
      
      // Handle presence sync (initial state and reconnections)
      next.on('presence', { event: 'sync' }, () => {
        if (!current()) return;
        const newPresenceMap = new Map<string, UserPresence>();
        
        // Parse presence state from all users
        for (const [userIdKey, entries] of Object.entries(next.presenceState<PresenceState>())) {
          if (!entries || entries.length === 0) continue;
          
          const latestEntry = entries[entries.length - 1];
          const userId = latestEntry.user_id;
          
          if (!userId) continue;
          
          newPresenceMap.set(userId, {
            userId,
            displayName: latestEntry.display_name,
            isOnline: true,
            lastSeenAt: latestEntry.last_seen_at || latestEntry.online_at,
            status: latestEntry.status || 'online'
          });
        }
        
        // Mark previously online users who are no longer in sync as offline
        for (const [userId, presence] of presenceMap.entries()) {
          if (!newPresenceMap.has(userId) && presence.isOnline) {
            newPresenceMap.set(userId, {
              ...presence,
              isOnline: false,
              status: 'offline'
            });
          }
        }
        
        // Update the presence map
        presenceMap.clear();
        for (const [userId, presence] of newPresenceMap.entries()) {
          presenceMap.set(userId, presence);
        }
        
        onPresenceUpdate(new Map(presenceMap));
      });

      // Handle individual user joins
      next.on('presence', { event: 'join' }, (payload: { key: string; newPresences: PresenceState[] }) => {
        if (!current()) return;
        
        for (const presenceState of payload.newPresences) {
          if (!presenceState.user_id) continue;
          
          presenceMap.set(presenceState.user_id, {
            userId: presenceState.user_id,
            displayName: presenceState.display_name,
            isOnline: true,
            lastSeenAt: presenceState.last_seen_at || presenceState.online_at,
            status: presenceState.status || 'online'
          });
        }
        
        onPresenceUpdate(new Map(presenceMap));
      });

      // Handle individual user leaves
      next.on('presence', { event: 'leave' }, (payload: { key: string; leftPresences: PresenceState[] }) => {
        if (!current()) return;
        
        for (const presenceState of payload.leftPresences) {
          if (!presenceState.user_id) continue;
          
          const existing = presenceMap.get(presenceState.user_id);
          if (existing) {
            presenceMap.set(presenceState.user_id, {
              ...existing,
              isOnline: false,
              status: 'offline',
              lastSeenAt: presenceState.last_seen_at || existing.lastSeenAt
            });
          }
        }
        
        onPresenceUpdate(new Map(presenceMap));
      });

      return next;
    },
    reconcile: async (signal, current) => {
      if (!channel || !current() || channel.state !== 'joined') return;
      
      if (visible) {
        const presenceState: PresenceState = {
          user_id: userId,
          display_name: displayName,
          online_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          status
        };
        
        const result = await channel.track(presenceState);
        if (result !== 'ok') {
          throw new Error('Presence tracking unavailable');
        }
      } else {
        await channel.untrack();
      }
    },
    status: (state) => {
      if (state !== 'connected' && state !== 'syncing') {
        // When disconnected, mark all users as offline but preserve their last seen info
        const updatedPresenceMap = new Map<string, UserPresence>();
        for (const [userId, presence] of presenceMap.entries()) {
          updatedPresenceMap.set(userId, {
            ...presence,
            isOnline: false,
            status: 'offline'
          });
        }
        presenceMap.clear();
        for (const [userId, presence] of updatedPresenceMap.entries()) {
          presenceMap.set(userId, presence);
        }
        onPresenceUpdate(new Map(presenceMap));
      }
    },
  });

  return () => {
    recovery.stop();
    onPresenceUpdate(new Map());
  };
}

/**
 * Update the current user's presence status (online, away, offline)
 */
export async function updatePresenceStatus(
  userId: string,
  status: 'online' | 'away' | 'offline',
  displayName: string
): Promise<boolean> {
  if (!supabase) return false;

  try {
    const channel = supabase.channel('gayze-presence-v2', {
      config: { presence: { key: userId } }
    });
    
    await channel.subscribe();
    
    if (status === 'offline') {
      await channel.untrack();
    } else {
      const presenceState: PresenceState = {
        user_id: userId,
        display_name: displayName,
        online_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        status
      };
      
      await channel.track(presenceState);
    }
    
    await supabase.removeChannel(channel);
    return true;
  } catch (error) {
    console.warn('[GAYZE] Presence status update failed:', error);
    return false;
  }
}

/**
 * Get the last seen timestamp for a specific user from their presence state.
 * Falls back to checking if they're currently online.
 */
export async function getUserLastSeen(userId: string): Promise<{ lastSeenAt?: string; isOnline: boolean }> {
  if (!supabase) return { isOnline: false };

  try {
    const channel = supabase.channel('gayze-presence-v2', {
      config: { presence: { key: userId } }
    });
    
    await channel.subscribe();
    
    const presenceState = channel.presenceState<PresenceState>();
    
    // Check if user is currently online
    for (const entries of Object.values(presenceState)) {
      for (const entry of entries) {
        if (entry.user_id === userId) {
          await supabase.removeChannel(channel);
          return {
            lastSeenAt: entry.last_seen_at || entry.online_at,
            isOnline: true
          };
        }
      }
    }
    
    await supabase.removeChannel(channel);
    return { isOnline: false };
  } catch (error) {
    console.warn('[GAYZE] Failed to get user last seen:', error);
    return { isOnline: false };
  }
}

/**
 * Simple helper to check if a user is currently online based on presence
 */
export function isUserOnline(userId: string, onlineUserIds: Set<string>): boolean {
  return onlineUserIds.has(userId);
}

/**
 * Format last seen timestamp for display
 */
export function formatLastSeen(lastSeenAt?: string): string {
  if (!lastSeenAt) return 'Last seen unavailable';
  
  const lastSeenDate = new Date(lastSeenAt);
  const now = new Date();
  const diffMs = now.getTime() - lastSeenDate.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) {
    return 'Just now';
  } else if (diffMinutes < 60) {
    return `Last seen ${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    return `Last seen ${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `Last seen ${diffDays}d ago`;
  } else {
    return `Last seen ${lastSeenDate.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
}