/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { RightNowView } from './components/RightNowView';
import { LaterView } from './components/LaterView';
import { SafeHavenView } from './components/SafeHavenView';
import { ChatRoomView } from './components/ChatRoomView';
import { DatingGridView } from './components/DatingGridView';
import { SafetyTimerModal } from './components/SafetyTimerModal';
import { DiscreetMaskView } from './components/DiscreetMaskView';
import { IdentityModal } from './components/IdentityModal';
import { SwarmQRModal } from './components/SwarmQRModal';
import { ScheduleMeetingModal } from './components/ScheduleMeetingModal';
import { EncryptedCallModal } from './components/EncryptedCallModal';
import { SetIntentSheet, UserActiveIntent } from './components/SetIntentSheet';
import { 
  Pulse, 
  Gathering, 
  SafeHaven, 
  SwarmRoom, 
  EncryptedMessage, 
  UserProfile, 
  SafetyCheckin,
  DatingProfile,
  SwarmQRPayload,
  SocialStory,
  IntentActivityPost,
  MeetingProposal
} from './types';
import { 
  INITIAL_USER, 
  INITIAL_PULSES, 
  INITIAL_GATHERINGS, 
  INITIAL_SAFE_HAVENS, 
  INITIAL_ROOMS, 
  INITIAL_MESSAGES, 
  INITIAL_SAFETY_CHECKIN,
  INITIAL_DATING_PROFILES,
  INITIAL_STORIES,
  INITIAL_INTENT_POSTS
} from './services/storageService';
import { encryptPayload, generateSafetyFingerprint, generateRandomKey } from './services/cryptoService';
import { 
  hapticQRHandshake, 
  hapticTimerWarning, 
  hapticTimerExpired, 
  hapticMessageDecrypted, 
  hapticSensitiveAction,
  hapticLight,
  triggerVibration
} from './services/hapticService';
import { Shield, Lock, Radio, Calendar, HeartHandshake, Eye, AlertCircle } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'dating' | 'right_now' | 'later' | 'swarms' | 'safe_havens'>('dating');
  
  // Core datasets with local state
  const [currentUser, setCurrentUser] = useState<UserProfile>(() => {
    const saved = localStorage.getItem('gayze_user');
    if (!saved) return INITIAL_USER;
    try {
      const parsed = JSON.parse(saved);
      return {
        ...INITIAL_USER,
        ...parsed,
        reliabilityScore: parsed.reliabilityScore || 94,
        verifiedPeersCount: parsed.verifiedPeersCount || 14,
      };
    } catch {
      return INITIAL_USER;
    }
  });

  const [datingProfiles, setDatingProfiles] = useState<DatingProfile[]>(() => {
    const saved = localStorage.getItem('gayze_dating_profiles');
    if (!saved) return INITIAL_DATING_PROFILES;
    try {
      const parsed: DatingProfile[] = JSON.parse(saved);
      return parsed.map((p, idx) => {
        const init = INITIAL_DATING_PROFILES.find((dp) => dp.id === p.id) || INITIAL_DATING_PROFILES[idx % INITIAL_DATING_PROFILES.length];
        return {
          ...init,
          ...p,
          reliabilityScore: p.reliabilityScore || init.reliabilityScore || 95,
          verifiedPeersCount: p.verifiedPeersCount || init.verifiedPeersCount || 10,
          verifiedViaQR: p.verifiedViaQR ?? init.verifiedViaQR ?? false,
        };
      });
    } catch {
      return INITIAL_DATING_PROFILES;
    }
  });

  const [pulses, setPulses] = useState<Pulse[]>(() => {
    const saved = localStorage.getItem('gayze_pulses');
    if (!saved) return INITIAL_PULSES;
    try {
      const parsed: Pulse[] = JSON.parse(saved);
      return parsed.map((p, idx) => {
        const initial = INITIAL_PULSES.find((ip) => ip.id === p.id) || INITIAL_PULSES[idx % INITIAL_PULSES.length];
        return {
          ...p,
          lat: typeof p.lat === 'number' && !isNaN(p.lat) ? p.lat : (initial?.lat ?? 51.5132),
          lng: typeof p.lng === 'number' && !isNaN(p.lng) ? p.lng : (initial?.lng ?? -0.1300),
          jitterMeters: p.jitterMeters || 300,
        };
      });
    } catch {
      return INITIAL_PULSES;
    }
  });

  const [gatherings, setGatherings] = useState<Gathering[]>(() => {
    const saved = localStorage.getItem('gayze_gatherings');
    if (!saved) return INITIAL_GATHERINGS;
    try {
      const parsed: Gathering[] = JSON.parse(saved);
      return parsed.map((g, idx) => {
        const initial = INITIAL_GATHERINGS.find((ig) => ig.id === g.id) || INITIAL_GATHERINGS[idx % INITIAL_GATHERINGS.length];
        return {
          ...g,
          lat: typeof g.lat === 'number' && !isNaN(g.lat) ? g.lat : (initial?.lat ?? 51.5255),
          lng: typeof g.lng === 'number' && !isNaN(g.lng) ? g.lng : (initial?.lng ?? -0.1248),
        };
      });
    } catch {
      return INITIAL_GATHERINGS;
    }
  });

  const [safeHavens, setSafeHavens] = useState<SafeHaven[]>(() => {
    const saved = localStorage.getItem('gayze_safe_havens');
    if (!saved) return INITIAL_SAFE_HAVENS;
    try {
      const parsed: SafeHaven[] = JSON.parse(saved);
      return parsed.map((s, idx) => {
        const initial = INITIAL_SAFE_HAVENS.find((is) => is.id === s.id) || INITIAL_SAFE_HAVENS[idx % INITIAL_SAFE_HAVENS.length];
        return {
          ...s,
          lat: typeof s.lat === 'number' && !isNaN(s.lat) ? s.lat : (initial?.lat ?? 51.5126),
          lng: typeof s.lng === 'number' && !isNaN(s.lng) ? s.lng : (initial?.lng ?? -0.1268),
        };
      });
    } catch {
      return INITIAL_SAFE_HAVENS;
    }
  });

  const [rooms, setRooms] = useState<SwarmRoom[]>(() => {
    const saved = localStorage.getItem('gayze_rooms');
    return saved ? JSON.parse(saved) : INITIAL_ROOMS;
  });

  const [messages, setMessages] = useState<Record<string, EncryptedMessage[]>>(() => {
    const saved = localStorage.getItem('gayze_messages');
    return saved ? JSON.parse(saved) : INITIAL_MESSAGES;
  });

  const [stories, setStories] = useState<SocialStory[]>(() => {
    const saved = localStorage.getItem('gayze_stories');
    return saved ? JSON.parse(saved) : INITIAL_STORIES;
  });

  const [intentPosts, setIntentPosts] = useState<IntentActivityPost[]>(() => {
    const saved = localStorage.getItem('gayze_intent_posts');
    return saved ? JSON.parse(saved) : INITIAL_INTENT_POSTS;
  });

  const [activeRoomId, setActiveRoomId] = useState<string>('room_marcus');

  // Safety Beacon State
  const [checkinState, setCheckinState] = useState<SafetyCheckin>(() => {
    const saved = localStorage.getItem('gayze_checkin');
    return saved ? JSON.parse(saved) : INITIAL_SAFETY_CHECKIN;
  });
  const [remainingSeconds, setRemainingSeconds] = useState<number>(3600);

  // Modals & Mask
  const [isMaskActive, setIsMaskActive] = useState(false);
  const [isIdentityOpen, setIsIdentityOpen] = useState(false);
  const [isSafetyTimerOpen, setIsSafetyTimerOpen] = useState(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [qrTargetPeer, setQrTargetPeer] = useState<DatingProfile | null>(null);
  const [notificationToast, setNotificationToast] = useState<string | null>(null);

  // Schedule Meeting Modal state
  const [isScheduleMeetingOpen, setIsScheduleMeetingOpen] = useState(false);
  const [scheduleMeetingPeerName, setScheduleMeetingPeerName] = useState<string>('Marcus');

  // Encrypted Calling state
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [callPeerName, setCallPeerName] = useState<string>('Marcus');
  const [callType, setCallType] = useState<'audio' | 'video'>('audio');

  // Set Intent Sheet state — canonical Right Now intent state.
  // Hydrate once from local storage so Discover / Right Now stay consistent
  // across tab changes and reloads.
  const [isSetIntentOpen, setIsSetIntentOpen] = useState(false);
  const [activeUserIntent, setActiveUserIntent] = useState<UserActiveIntent | null>(() => {
    try {
      const saved = localStorage.getItem('gayze_active_user_intent');
      if (!saved) return null;
      const parsed = JSON.parse(saved) as UserActiveIntent;
      return parsed.expiresAt > Date.now() ? parsed : null;
    } catch {
      return null;
    }
  });

  // Sync to LocalStorage
  useEffect(() => {
    localStorage.setItem('gayze_user', JSON.stringify(currentUser));
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem('gayze_dating_profiles', JSON.stringify(datingProfiles));
  }, [datingProfiles]);

  useEffect(() => {
    localStorage.setItem('gayze_pulses', JSON.stringify(pulses));
  }, [pulses]);

  useEffect(() => {
    localStorage.setItem('gayze_gatherings', JSON.stringify(gatherings));
  }, [gatherings]);

  useEffect(() => {
    localStorage.setItem('gayze_rooms', JSON.stringify(rooms));
  }, [rooms]);

  useEffect(() => {
    localStorage.setItem('gayze_messages', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    localStorage.setItem('gayze_stories', JSON.stringify(stories));
  }, [stories]);

  useEffect(() => {
    localStorage.setItem('gayze_intent_posts', JSON.stringify(intentPosts));
  }, [intentPosts]);

  useEffect(() => {
    localStorage.setItem('gayze_checkin', JSON.stringify(checkinState));
  }, [checkinState]);

  // Safety Timer Interval with Vibration API Haptic Warnings
  useEffect(() => {
    let interval: any = null;
    if (checkinState.isActive && remainingSeconds > 0) {
      interval = setInterval(() => {
        setRemainingSeconds((prev) => {
          // Trigger tactile haptic warning when nearing expiration (at 60s, 30s, 10s, and final 5s countdown)
          if (prev === 61 || prev === 31 || prev === 11 || (prev <= 6 && prev > 1)) {
            hapticTimerWarning();
          }

          if (prev <= 1) {
            clearInterval(interval);
            hapticTimerExpired();
            showToast('⚠️ Safety Beacon expired! Automated distress signal primed.');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [checkinState.isActive, remainingSeconds]);

  // Keyboard shortcut: Escape enters mask mode if nothing open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isIdentityOpen && !isSafetyTimerOpen) {
        setIsMaskActive((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isIdentityOpen, isSafetyTimerOpen]);

  const showToast = (msg: string) => {
    setNotificationToast(msg);
    setTimeout(() => setNotificationToast(null), 4000);
  };

  // Handlers for "Right Now"
  const handleOpenDirectChatFromPulse = async (pulse: Pulse) => {
    // Check if room already exists
    const existingRoom = rooms.find((r) => r.peerKey?.includes(pulse.peerShortKey) || r.name === pulse.peerName);

    if (existingRoom) {
      setActiveRoomId(existingRoom.id);
      setActiveTab('swarms');
      return;
    }

    // Create new direct encrypted room with peer
    const roomId = `room_${pulse.peerId}_${Date.now()}`;
    const safetyNumber = await generateSafetyFingerprint(currentUser.publicKey, pulse.peerShortKey);
    const newRoom: SwarmRoom = {
      id: roomId,
      name: pulse.peerName,
      type: 'direct',
      peerKey: pulse.peerShortKey + '_full_public_key_verified',
      peerName: pulse.peerName,
      peerNeighborhood: pulse.neighborhood,
      peerAvatar: pulse.peerAvatar,
      safetyNumber,
      swarmSecretKeyHex: 'seed_swarm_' + Math.random().toString(36).substring(2),
      lastMessage: `Connected via pulse: "${pulse.title}"`,
      lastTimestamp: Date.now(),
      ephemeralTtlSeconds: 3600, // default 1 hr burner
    };

    const initialMsg: EncryptedMessage = {
      id: 'msg_init_' + Date.now(),
      roomId,
      senderKey: currentUser.publicKey,
      senderName: currentUser.displayName,
      timestamp: Date.now(),
      cipherText: '9a01f8...encrypted',
      nonceHex: '190284719203847102938471',
      plainText: `Hey ${pulse.peerName}, saw your pulse for ${pulse.title}!`,
    };

    setRooms((prev) => [newRoom, ...prev]);
    setMessages((prev) => ({
      ...prev,
      [roomId]: [initialMsg],
    }));

    setActiveRoomId(roomId);
    setActiveTab('swarms');
    showToast(`End-to-End Encrypted Group opened with ${pulse.peerName}`);
  };

  // Handlers for "Dating"
  const handleToggleFavoriteProfile = (profileId: string) => {
    setDatingProfiles((prev) =>
      prev.map((p) => {
        if (p.id === profileId) {
          const nextFav = !p.isFavorited;
          showToast(nextFav ? `Saved ${p.name} to favorites` : `Removed ${p.name} from favorites`);
          return { ...p, isFavorited: nextFav };
        }
        return p;
      })
    );
  };

  const handleOpenDirectChatWithProfile = async (profile: DatingProfile) => {
    const existingRoom = rooms.find(
      (r) => r.peerKey?.includes(profile.peerPublicKey.slice(0, 16)) || r.name.startsWith(profile.name)
    );

    if (existingRoom) {
      setActiveRoomId(existingRoom.id);
      setActiveTab('swarms');
      return;
    }

    const roomId = `room_prof_${profile.id}_${Date.now()}`;
    const safetyNumber = await generateSafetyFingerprint(currentUser.publicKey, profile.peerPublicKey);
    const newRoom: SwarmRoom = {
      id: roomId,
      name: `${profile.name}, ${profile.age}`,
      type: 'direct',
      peerKey: profile.peerPublicKey,
      peerName: profile.name,
      peerNeighborhood: profile.neighborhood,
      peerAvatar: profile.name.toLowerCase(),
      safetyNumber,
      swarmSecretKeyHex: 'seed_swarm_' + Math.random().toString(36).substring(2),
      lastMessage: `Connected via Gayze Dating · ${profile.headline}`,
      lastTimestamp: Date.now(),
      ephemeralTtlSeconds: 86400, // 24hr default
    };

    const initialMsg: EncryptedMessage = {
      id: 'msg_prof_init_' + Date.now(),
      roomId,
      senderKey: currentUser.publicKey,
      senderName: currentUser.displayName,
      timestamp: Date.now(),
      cipherText: '9a01f8...encrypted',
      nonceHex: '190284719203847102938471',
      plainText: `Direct private chat opened with ${profile.name}. Location protected by ~300m privacy blur.`,
      isSystem: true,
    };

    setRooms((prev) => [newRoom, ...prev]);
    setMessages((prev) => ({
      ...prev,
      [roomId]: [initialMsg],
    }));
    setActiveRoomId(roomId);
    setActiveTab('swarms');
    showToast(`Encrypted chat opened with ${profile.name}`);
  };

  const handleProposeHavenDate = async (profile: DatingProfile, havenName?: string) => {
    const targetHaven = havenName || profile.favoriteSafeHaven || 'Timberyard Community Cafe';
    await handleOpenDirectChatWithProfile(profile);
    showToast(`Date proposal at ${targetHaven} ready in chat`);
  };

  // Handlers for Swarm QR Key Exchange & In-Person Verification
  const handleOpenQRModal = (targetPeer?: DatingProfile | null) => {
    setQrTargetPeer(targetPeer || null);
    setIsQRModalOpen(true);
  };

  const handleVerifyPeer = async (payload: SwarmQRPayload) => {
    // Trigger tactile haptic double-pulse upon verified in-person cryptographic handshake
    hapticQRHandshake();

    // 1. Boost current user's reliability score and increment verified peers
    let nextUserScore = 95;
    setCurrentUser((prev) => {
      nextUserScore = Math.min(100, (prev.reliabilityScore || 94) + 3);
      const newCount = (prev.verifiedPeersCount || 14) + 1;
      return {
        ...prev,
        reliabilityScore: nextUserScore,
        verifiedPeersCount: newCount,
      };
    });

    // 2. Boost the peer's reliability score in dating profiles if present
    setDatingProfiles((prev) =>
      prev.map((p) => {
        if (
          p.peerPublicKey === payload.publicKey ||
          p.name.toLowerCase() === payload.displayName.toLowerCase()
        ) {
          return {
            ...p,
            reliabilityScore: Math.min(100, (p.reliabilityScore || 95) + 3),
            verifiedPeersCount: (p.verifiedPeersCount || 10) + 1,
            verifiedViaQR: true,
          };
        }
        return p;
      })
    );

    // 3. Find or create the direct Swarm Room
    let existingRoom = rooms.find(
      (r) =>
        r.peerKey?.includes(payload.publicKey.slice(0, 16)) ||
        r.name.toLowerCase().startsWith(payload.displayName.toLowerCase())
    );

    const roomId = existingRoom ? existingRoom.id : `room_qr_${Date.now()}`;
    const peerScore = Math.min(100, (payload.reliabilityScore || 95) + 3);

    if (!existingRoom) {
      const safetyNumber = await generateSafetyFingerprint(currentUser.publicKey, payload.publicKey);
      const newRoom: SwarmRoom = {
        id: roomId,
        name: payload.displayName,
        type: 'direct',
        peerKey: payload.publicKey,
        peerName: payload.displayName,
        peerNeighborhood: payload.neighborhood,
        peerAvatar: payload.displayName.toLowerCase().slice(0, 8),
        safetyNumber,
        swarmSecretKeyHex: 'seed_qr_swarm_' + Math.random().toString(36).substring(2),
        lastMessage: `Verified in-person via Group QR · Reliability Score: ${peerScore}/100`,
        lastTimestamp: Date.now(),
        ephemeralTtlSeconds: 86400,
        verifiedViaQR: true,
        verifiedAt: Date.now(),
        peerReliabilityScore: peerScore,
      };
      setRooms((prev) => [newRoom, ...prev]);
    } else {
      setRooms((prev) =>
        prev.map((r) =>
          r.id === roomId
            ? {
                ...r,
                verifiedViaQR: true,
                verifiedAt: Date.now(),
                peerReliabilityScore: peerScore,
                lastMessage: `Verified in-person via Group QR · Reliability Score: ${peerScore}/100`,
                lastTimestamp: Date.now(),
              }
            : r
        )
      );
    }

    // 4. Send encrypted system verification message into the room
    const verifiedSystemMsg: EncryptedMessage = {
      id: 'msg_qr_verif_' + Date.now(),
      roomId,
      senderKey: currentUser.publicKey,
      senderName: currentUser.displayName,
      timestamp: Date.now(),
      cipherText: '3a0b9f...verified_handshake',
      nonceHex: '891048192038471029384710',
      plainText: `🔒 In-Person Group QR verification complete. Mutual public keys authenticated. Safety fingerprint matched. Reliability score boosted (+3 pts to both peers).`,
      isSystem: true,
    };

    setMessages((prev) => ({
      ...prev,
      [roomId]: [...(prev[roomId] || []), verifiedSystemMsg],
    }));

    setActiveRoomId(roomId);
    showToast(`✓ Key exchange confirmed with ${payload.displayName}! Reliability Score: ${nextUserScore}/100 (+3)`);
  };

  // Handlers for "Later"
  const handleToggleRsvp = (gatheringId: string) => {
    setGatherings((prev) =>
      prev.map((g) => {
        if (g.id === gatheringId) {
          const nextState = !g.isAttending;
          showToast(nextState ? `✓ RSVP confirmed for ${g.title}` : `RSVP cancelled for ${g.title}`);
          return {
            ...g,
            isAttending: nextState,
            rsvpCount: nextState ? g.rsvpCount + 1 : Math.max(0, g.rsvpCount - 1),
          };
        }
        return g;
      })
    );
  };

  const handleOpenGatheringChat = (gathering: Gathering) => {
    const existing = rooms.find((r) => r.id === 'room_' + gathering.id || r.name.includes(gathering.title.substring(0, 15)));
    if (existing) {
      setActiveRoomId(existing.id);
      setActiveTab('swarms');
      return;
    }

    const roomId = 'room_' + gathering.id;
    const newRoom: SwarmRoom = {
      id: roomId,
      name: gathering.title + ' Group',
      type: 'gathering',
      safetyNumber: '88201 94819 20491 58190 29481 02938',
      swarmSecretKeyHex: 'seed_gathering_' + gathering.id,
      lastMessage: `Joined encrypted coordination room for ${gathering.locationName}`,
      lastTimestamp: Date.now(),
      ephemeralTtlSeconds: 0,
    };

    setRooms((prev) => [newRoom, ...prev]);
    setActiveRoomId(roomId);
    setActiveTab('swarms');
  };

  const handleCreatePulse = (newPulse: Omit<Pulse, 'id' | 'createdAt' | 'expiresAt'>) => {
    const pulse: Pulse = {
      ...newPulse,
      id: 'pulse_' + Date.now(),
      createdAt: Date.now(),
      expiresAt: Date.now() + newPulse.durationHours * 3600 * 1000,
    };
    setPulses((prev) => [pulse, ...prev]);
    showToast('✓ Pulse posted with approximate location (~250m privacy zone)!');
  };

  const handleCreateGathering = (newGathering: Omit<Gathering, 'id' | 'rsvpCount' | 'isAttending'>) => {
    const gathering: Gathering = {
      ...newGathering,
      id: 'gath_' + Date.now(),
      rsvpCount: 1,
      isAttending: true,
    };
    setGatherings((prev) => [gathering, ...prev]);
    showToast('✓ Gathering created! Group chat room is ready.');
  };

  // Chat message sending with real WebCrypto AES-GCM
  const handleSendMessage = async (roomId: string, plainText: string, ephemeralTtlSeconds?: number, meetingData?: MeetingProposal) => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;

    // Encrypt payload with WebCrypto AES-GCM
    const { cipherHex, nonceHex } = await encryptPayload(plainText, room.swarmSecretKeyHex);

    const newMsg: EncryptedMessage = {
      id: 'msg_' + Date.now(),
      roomId,
      senderKey: currentUser.publicKey,
      senderName: currentUser.displayName,
      timestamp: Date.now(),
      cipherText: cipherHex,
      nonceHex,
      plainText,
      ephemeralTtlSeconds: ephemeralTtlSeconds || room.ephemeralTtlSeconds,
      meetingData,
    };

    setMessages((prev) => ({
      ...prev,
      [roomId]: [...(prev[roomId] || []), newMsg],
    }));

    setRooms((prev) =>
      prev.map((r) =>
        r.id === roomId
          ? { ...r, lastMessage: plainText, lastTimestamp: Date.now() }
          : r
      )
    );

    // If direct chat, simulate an authentic, friendly peer reply after 1.5s
    if (room.type === 'direct') {
      setTimeout(async () => {
        let randomReply: string;
        if (meetingData) {
          randomReply = `Sounds fantastic! I'd love to meet at ${meetingData.venueName} (${meetingData.timeStr}). Looking forward to it!`;
        } else {
          const peerReplies = [
            "Hey! Sounds great. I'm right nearby in the courtyard area.",
            "Awesome. Let me know when you get here, I'll keep an eye out.",
            "Perfect! I appreciate you verifying the safety number too.",
            "Looking forward to it! See you shortly in the public lounge."
          ];
          randomReply = peerReplies[Math.floor(Math.random() * peerReplies.length)];
        }
        const encPeer = await encryptPayload(randomReply, room.swarmSecretKeyHex);

        const peerMsg: EncryptedMessage = {
          id: 'msg_peer_' + Date.now(),
          roomId,
          senderKey: room.peerKey || 'peer_key',
          senderName: room.name,
          timestamp: Date.now(),
          cipherText: encPeer.cipherHex,
          nonceHex: encPeer.nonceHex,
          plainText: randomReply,
          ephemeralTtlSeconds: room.ephemeralTtlSeconds,
        };

        setMessages((prev) => ({
          ...prev,
          [roomId]: [...(prev[roomId] || []), peerMsg],
        }));

        // Haptic feedback for incoming encrypted peer message decrypted locally
        hapticMessageDecrypted();

        setRooms((prev) =>
          prev.map((r) =>
            r.id === roomId
              ? { ...r, lastMessage: randomReply, lastTimestamp: Date.now() }
              : r
          )
        );
      }, 1500);
    }
  };

  const handleUpdateRoomTtl = (roomId: string, ttl: number) => {
    setRooms((prev) =>
      prev.map((r) => (r.id === roomId ? { ...r, ephemeralTtlSeconds: ttl } : r))
    );
    showToast(ttl === 0 ? 'Auto-delete turned off (messages will be kept)' : `Messages will auto-delete after ${ttl >= 3600 ? ttl / 3600 + 'h' : ttl / 60 + 'm'}`);
  };

  // Meeting Scheduling & Acceptance Handlers
  const handleOpenScheduleMeeting = (peerName: string) => {
    setScheduleMeetingPeerName(peerName);
    setIsScheduleMeetingOpen(true);
  };

  const handleConfirmMeeting = async (proposal: {
    venueName: string;
    address: string;
    timeStr: string;
    isSafeHaven: boolean;
    durationMinutes: number;
    armSafetyBeacon: boolean;
  }) => {
    setIsScheduleMeetingOpen(false);

    // If arming safety beacon immediately
    if (proposal.armSafetyBeacon) {
      handleStartSafetyTimer({
        partnerName: scheduleMeetingPeerName,
        venueName: proposal.venueName,
        durationMinutes: proposal.durationMinutes || 60,
        notes: `Meeting with ${scheduleMeetingPeerName} at ${proposal.venueName} (${proposal.timeStr})`,
      });
    }

    // Find or create direct room with this peer
    let targetRoom = rooms.find(
      (r) =>
        r.peerName?.toLowerCase() === scheduleMeetingPeerName.toLowerCase() ||
        r.name.toLowerCase().startsWith(scheduleMeetingPeerName.toLowerCase())
    );

    let roomId = targetRoom?.id;
    if (!targetRoom) {
      roomId = `room_${Date.now()}`;
      const safetyNumber = await generateSafetyFingerprint(currentUser.publicKey, scheduleMeetingPeerName);
      targetRoom = {
        id: roomId,
        name: scheduleMeetingPeerName,
        type: 'direct',
        peerKey: 'pk_' + scheduleMeetingPeerName.toLowerCase(),
        peerName: scheduleMeetingPeerName,
        peerNeighborhood: currentUser.neighborhood,
        peerAvatar: scheduleMeetingPeerName.toLowerCase(),
        safetyNumber,
        swarmSecretKeyHex: 'seed_room_' + Math.random().toString(36).substring(2),
        lastMessage: `Meeting proposed at ${proposal.venueName}`,
        lastTimestamp: Date.now(),
        ephemeralTtlSeconds: 86400,
      };
      setRooms((prev) => [targetRoom!, ...prev]);
    }

    const meetingData: MeetingProposal = {
      id: 'meet_' + Date.now(),
      venueName: proposal.venueName,
      address: proposal.address,
      timeStr: proposal.timeStr,
      timestamp: Date.now(),
      status: 'proposed',
      isSafeHaven: proposal.isSafeHaven,
      safetyTimerDurationMinutes: proposal.durationMinutes || 60,
    };

    await handleSendMessage(
      targetRoom.id,
      `📅 Safe Meetup Invitation: Let's meet at ${proposal.venueName} (${proposal.timeStr}).`,
      targetRoom.ephemeralTtlSeconds,
      meetingData
    );

    setActiveRoomId(targetRoom.id);
    setActiveTab('swarms');
    showToast(`✓ Meetup proposal sent to ${scheduleMeetingPeerName} at ${proposal.venueName}`);
  };

  const handleAcceptMeeting = async (meeting: MeetingProposal) => {
    // Arm safety timer for user
    handleStartSafetyTimer({
      partnerName: 'Peer',
      venueName: meeting.venueName,
      durationMinutes: meeting.safetyTimerDurationMinutes || 60,
      notes: `Accepted meetup at ${meeting.venueName} (${meeting.timeStr})`,
    });

    // Update message state in current active room
    setMessages((prev) => {
      const roomMsgs = prev[activeRoomId] || [];
      const updated = roomMsgs.map((m) => {
        if (m.meetingData && m.meetingData.id === meeting.id) {
          return {
            ...m,
            meetingData: {
              ...m.meetingData,
              status: 'accepted' as const,
            },
          };
        }
        return m;
      });
      return { ...prev, [activeRoomId]: updated };
    });

    // Send confirmation in room
    await handleSendMessage(
      activeRoomId,
      `✓ Accepted! I'll see you at ${meeting.venueName} (${meeting.timeStr}). Safety Beacon armed.`
    );
    showToast(`🛡️ Meeting accepted! Safety beacon armed for ${meeting.venueName}.`);
  };

  // Calling & Gaze Handlers
  const handleStartCall = (peerName: string, type: 'audio' | 'video') => {
    setCallPeerName(peerName);
    setCallType(type);
    setIsCallModalOpen(true);
  };

  const handleGazeAtPeer = (peerName: string) => {
    triggerVibration([40, 70]);
    showToast(`👁️ You gave a Gaze to ${peerName}! Mutual gazes alert immediately.`);

    // If gazing at an active peer, simulate mutual gaze response
    if (peerName === 'Marcus' || peerName === 'Soren' || peerName === 'Liam') {
      setTimeout(() => {
        triggerVibration([50, 40, 90]);
        showToast(`⚡ Mutual Gaze! ${peerName} noticed you too.`);
      }, 1600);
    }
  };

  const handleSaveUserIntent = (intent: UserActiveIntent) => {
    hapticSensitiveAction();
    setActiveUserIntent(intent);
    setIsSetIntentOpen(false);

    // Add as a live story
    const newStory: SocialStory = {
      id: 'story_user_' + Date.now(),
      peerId: currentUser.publicKey,
      peerName: currentUser.displayName,
      avatarUrl: '/src/assets/images/dating_profile_marcus_1790154961749.jpg',
      photoUrl: '/src/assets/images/dating_profile_marcus_1790154961749.jpg',
      caption: `Status: ${intent.intent} · ${intent.when} around ${intent.area}`,
      locationName: intent.isNearSafeHaven && intent.safeHavenName ? intent.safeHavenName : intent.area,
      timestamp: Date.now(),
      intent: intent.intent,
      category: intent.intent.includes('Hookup') ? 'private' : 'social',
    };
    setStories((prev) => [newStory, ...prev]);

    // Add as an intent activity post
    const newPost: IntentActivityPost = {
      id: 'post_user_' + Date.now(),
      peerId: currentUser.publicKey,
      peerName: currentUser.displayName,
      peerAvatar: 'user',
      photoUrl: '/src/assets/images/dating_profile_marcus_1790154961749.jpg',
      activityTitle: `${intent.intent} · ${intent.when}`,
      description: `Looking to connect around ${intent.area}. Context: ${intent.context || 'Flexible'} · Duration: ${intent.duration}`,
      category: intent.intent.includes('Hookup') ? 'private' : 'social',
      intent: intent.intent,
      timing: intent.when === 'Now' ? 'Right Now' : (intent.when as IntentActivityPost['timing']) || 'Right Now',
      venueName: intent.isNearSafeHaven && intent.safeHavenName ? intent.safeHavenName : intent.area,
      neighborhood: intent.area,
      approxDistanceKm: 0.1,
      timestamp: Date.now(),
      isSafeHaven: Boolean(intent.isNearSafeHaven),
      reliabilityScore: currentUser.reliabilityScore || 95,
      gazesCount: 0,
    };
    setIntentPosts((prev) => [newPost, ...prev]);

    showToast(`✓ Status updated: ${intent.intent} (${intent.when})`);
  };

  // Safety Timer Handlers
  const handleStartSafetyTimer = (data: { partnerName: string; venueName: string; durationMinutes: number; notes: string }) => {
    hapticSensitiveAction();
    const totalSecs = data.durationMinutes * 60;
    setCheckinState({
      isActive: true,
      meetupPartnerName: data.partnerName,
      venueName: data.venueName,
      startedAt: Date.now(),
      durationMinutes: data.durationMinutes,
      notes: data.notes,
      emergencyBuddyPings: 2,
    });
    setRemainingSeconds(totalSecs);
    setIsSafetyTimerOpen(false);
    showToast(`🛡️ Safety Beacon active for ${data.durationMinutes} minutes at ${data.venueName}`);
  };

  const handleExtendTimer = (extraMinutes: number) => {
    hapticSensitiveAction();
    setRemainingSeconds((prev) => prev + extraMinutes * 60);
    showToast(`✓ Safety check-in extended by ${extraMinutes} minutes.`);
  };

  const handleEndCheckin = () => {
    hapticSensitiveAction();
    setCheckinState((prev) => ({ ...prev, isActive: false }));
    showToast('✓ Meetup checked in safely! Beacon deactivated.');
  };

  const handleTriggerDistressBeacon = () => {
    hapticTimerExpired();
    showToast('🚨 Encrypted distress alert broadcasted with location to emergency contacts!');
  };

  const handlePurgeLocalCache = () => {
    hapticSensitiveAction();
    localStorage.clear();
    setMessages({});
    showToast('Decrypted local storage securely wiped.');
  };

  // If Discreet Mask is triggered, render pure camouflage
  if (isMaskActive) {
    return <DiscreetMaskView onExitMask={() => setIsMaskActive(false)} />;
  }

  return (
    <div className="min-h-screen bg-[#090a0f] text-[#f1f3f7] flex flex-col font-sans selection:bg-[#C9A24D]/25 selection:text-[#C9A24D]">
      {/* Toast Notification */}
      {notificationToast && (
        <div className="fixed top-16 left-3 right-3 sm:left-auto sm:right-4 z-50 bg-[#11131a]/95 backdrop-blur-md border border-white/10 text-white text-xs px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2">
          <Shield className="w-4 h-4 text-[#C9A24D] shrink-0" />
          <span className="truncate font-medium">{notificationToast}</span>
        </div>
      )}

      {/* Keet-Inspired Top Bar */}
      <Navbar
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
        unreadCount={0}
        onOpenMask={() => setIsMaskActive(true)}
        onOpenIdentity={() => setIsIdentityOpen(true)}
        onOpenSafetyTimer={() => setIsSafetyTimerOpen(true)}
        isSafetyTimerActive={checkinState.isActive}
        onOpenQR={() => handleOpenQRModal()}
        reliabilityScore={currentUser.reliabilityScore || 94}
      />

      {/* Main Content Viewport Container */}
      <main
        className={
          activeTab === 'right_now'
            ? 'flex-1 min-h-0 w-full h-[calc(100dvh-3.5rem)] relative overflow-hidden p-0'
            : 'flex-1 min-h-0 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 pb-24 md:pb-8 overflow-y-auto'
        }
      >
        {activeTab === 'dating' && (
          <DatingGridView
            profiles={datingProfiles}
            safeHavens={safeHavens}
            userNeighborhood={currentUser.neighborhood}
            stories={stories}
            intentPosts={intentPosts}
            activeUserIntent={activeUserIntent}
            currentUser={currentUser}
            onOpenDirectChatWithProfile={handleOpenDirectChatWithProfile}
            onProposeHavenDate={handleProposeHavenDate}
            onToggleFavorite={handleToggleFavoriteProfile}
            onOpenQRWithPeer={(profile) => handleOpenQRModal(profile)}
            onGazeAtPeer={handleGazeAtPeer}
            onOpenScheduleMeeting={handleOpenScheduleMeeting}
            onOpenSetIntent={() => setIsSetIntentOpen(true)}
          />
        )}

        {activeTab === 'right_now' && (
          <RightNowView
            pulses={pulses}
            safeHavens={safeHavens}
            userNeighborhood={currentUser.neighborhood}
            privacySetting={currentUser.privacySetting}
            datingProfiles={datingProfiles}
            stories={stories}
            activeUserIntent={activeUserIntent}
            onOpenDirectChat={handleOpenDirectChatFromPulse}
            onOpenDirectChatWithProfile={handleOpenDirectChatWithProfile}
            onSelectHaven={(h) => {
              setActiveTab('safe_havens');
            }}
            onCreatePulse={handleCreatePulse}
            onGazeAtPeer={handleGazeAtPeer}
            onOpenScheduleMeeting={handleOpenScheduleMeeting}
            onOpenSetIntent={() => setIsSetIntentOpen(true)}
          />
        )}

        {activeTab === 'later' && (
          <LaterView
            gatherings={gatherings}
            onToggleRsvp={handleToggleRsvp}
            onOpenGatheringChat={handleOpenGatheringChat}
            onCreateGathering={handleCreateGathering}
          />
        )}

        {activeTab === 'swarms' && (
          <ChatRoomView
            rooms={rooms}
            messages={messages}
            activeRoomId={activeRoomId}
            onSelectRoom={(id) => setActiveRoomId(id)}
            currentUser={currentUser}
            onSendMessage={handleSendMessage}
            onUpdateRoomTtl={handleUpdateRoomTtl}
            onOpenQR={(peerName) => {
              const matchedPeer = datingProfiles.find(
                (p) => p.name.toLowerCase() === peerName?.toLowerCase()
              );
              handleOpenQRModal(matchedPeer || null);
            }}
            onStartCall={handleStartCall}
            onOpenScheduleMeeting={handleOpenScheduleMeeting}
            onAcceptMeeting={handleAcceptMeeting}
          />
        )}

        {activeTab === 'safe_havens' && (
          <SafeHavenView
            safeHavens={safeHavens}
            onSelectVenueForPulse={(haven) => {
              setActiveTab('right_now');
              showToast(`Broadcasting pulse at ${haven.name}`);
            }}
            onStartSafeCheckinWithVenue={(haven) => {
              setIsSafetyTimerOpen(true);
            }}
          />
        )}
      </main>

      {/* Schedule Meeting & Safe Haven Date Modal */}
      <ScheduleMeetingModal
        isOpen={isScheduleMeetingOpen}
        onClose={() => setIsScheduleMeetingOpen(false)}
        peerName={scheduleMeetingPeerName}
        safeHavens={safeHavens}
        onConfirmMeeting={handleConfirmMeeting}
      />

      {/* Encrypted Audio & Video Call Modal */}
      <EncryptedCallModal
        isOpen={isCallModalOpen}
        onClose={() => setIsCallModalOpen(false)}
        peerName={callPeerName}
        callType={callType}
      />

      {/* Universal Set Intent Sheet */}
      <SetIntentSheet
        isOpen={isSetIntentOpen}
        onClose={() => setIsSetIntentOpen(false)}
        onSaveIntent={handleSaveUserIntent}
        existingIntent={activeUserIntent}
        safeHavens={safeHavens}
        userNeighborhood={currentUser.neighborhood}
      />

      {/* Safety Beacon Timer Modal */}
      <SafetyTimerModal
        isOpen={isSafetyTimerOpen}
        onClose={() => setIsSafetyTimerOpen(false)}
        checkinState={checkinState}
        onStartTimer={handleStartSafetyTimer}
        onExtendTimer={handleExtendTimer}
        onEndCheckin={handleEndCheckin}
        onTriggerDistressBeacon={handleTriggerDistressBeacon}
        remainingSeconds={remainingSeconds}
      />

      {/* Cryptographic Swarm Identity & Privacy Modal */}
      <IdentityModal
        isOpen={isIdentityOpen}
        onClose={() => setIsIdentityOpen(false)}
        user={currentUser}
        onUpdateUser={(updated) => setCurrentUser((prev) => ({ ...prev, ...updated }))}
        onPurgeLocalCache={handlePurgeLocalCache}
        onOpenQR={() => handleOpenQRModal()}
      />

      {/* Swarm QR Code Generator & Peer Key Exchange Modal */}
      <SwarmQRModal
        isOpen={isQRModalOpen}
        onClose={() => {
          setIsQRModalOpen(false);
          setQrTargetPeer(null);
        }}
        currentUser={currentUser}
        datingProfiles={datingProfiles}
        targetPeer={qrTargetPeer}
        onVerifyPeer={handleVerifyPeer}
      />
    </div>
  );
}
