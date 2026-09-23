export type LocationPrivacy = 'fuzzy_500m' | 'neighborhood' | 'ghost';

export interface UserProfile {
  publicKey: string;
  shortKey: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarSeed: string;
  neighborhood: string;
  privacySetting: LocationPrivacy;
  safetyVerified: boolean;
  interests: string[];
  reliabilityScore: number; // e.g. 95/100
  verifiedPeersCount: number; // In-person QR verified peers
  hapticsEnabled?: boolean; // Vibration API haptic feedback preference
}

export interface Pulse {
  id: string;
  peerId: string;
  peerName: string;
  peerShortKey: string;
  peerAvatar: string;
  title: string;
  description: string;
  activityCategory: 'coffee' | 'drinks' | 'walk' | 'active' | 'culture' | 'chill';
  venueName: string;
  neighborhood: string;
  approxDistanceKm: number;
  jitterMeters: number;
  lat: number;
  lng: number;
  durationHours: number;
  createdAt: number;
  expiresAt: number;
  tags: string[];
  safeHavenVenue?: boolean;
}

export interface Gathering {
  id: string;
  hostId: string;
  hostName: string;
  hostShortKey: string;
  hostAvatar: string;
  title: string;
  description: string;
  category: 'social' | 'arts' | 'active' | 'games' | 'discussions' | 'nightlife';
  dateStr: string; // e.g. 'Tonight', 'Tomorrow', 'Saturday, 19:30'
  timestamp: number;
  locationName: string;
  address: string;
  neighborhood: string;
  isSafeHavenVenue: boolean;
  lat: number;
  lng: number;
  capacity: number;
  rsvpCount: number;
  isAttending: boolean;
  tags: string[];
  safetyGuidelines: string;
}

export interface SafeHaven {
  id: string;
  name: string;
  type: 'cafe' | 'bookstore' | 'community_center' | 'queer_bar' | 'public_square';
  address: string;
  neighborhood: string;
  safetyScore: number; // e.g. 9.8
  features: string[];
  lat: number;
  lng: number;
  openHours: string;
  approxDistanceKm: number;
  emergencyPhone?: string;
  staffTrained: boolean;
}

export interface EncryptedMessage {
  id: string;
  roomId: string;
  senderKey: string;
  senderName: string;
  timestamp: number;
  cipherText: string;
  nonceHex: string;
  plainText: string;
  ephemeralTtlSeconds?: number;
  isBurned?: boolean;
  isSystem?: boolean;
}

export interface SwarmRoom {
  id: string;
  name: string;
  type: 'direct' | 'gathering';
  peerKey?: string;
  peerName?: string;
  peerNeighborhood?: string;
  peerAvatar?: string;
  safetyNumber: string; // e.g. "4920 1823 8812 3901 0291 9410"
  swarmSecretKeyHex: string;
  lastMessage?: string;
  lastTimestamp: number;
  ephemeralTtlSeconds: number; // 0 = off, 300 = 5min, 3600 = 1hr, 86400 = 24hr
  verifiedViaQR?: boolean;
  verifiedAt?: number;
  peerReliabilityScore?: number;
}

export interface DatingProfile {
  id: string;
  name: string;
  age: number;
  photoUrl: string;
  neighborhood: string;
  approxDistanceKm: number;
  headline: string;
  bio: string;
  lookingFor: 'dating' | 'dates_coffee' | 'casual' | 'relationship' | 'friends';
  lookingForLabel: string;
  heightCm: number;
  rolePronouns?: string;
  interests: string[];
  tribes: string[];
  isOnline: boolean;
  lastActive: string;
  safetyVerified: boolean;
  peerPublicKey: string;
  favoriteSafeHaven?: string;
  isFavorited?: boolean;
  reliabilityScore: number;
  verifiedPeersCount: number;
  verifiedViaQR?: boolean;
}

export interface SwarmQRPayload {
  v: number;
  type: 'gayze_swarm_identity';
  publicKey: string;
  shortKey: string;
  displayName: string;
  neighborhood: string;
  reliabilityScore: number;
  verifiedPeersCount: number;
  timestamp: number;
  fingerprint?: string;
}

export interface SafetyCheckin {
  isActive: boolean;
  meetupPartnerName: string;
  venueName: string;
  startedAt: number;
  durationMinutes: number;
  notes: string;
  emergencyBuddyPings: number;
}
