# GAYZE — Backend Requirements (Supabase)

This client is written against a Supabase backend that is **not** described by any
migration file in this repository. Everything below was derived from the call sites in
`src/services/supabaseService.ts`, and lists exactly what the client expects — plus the
gaps that currently force the UI into an honest "not available" state.

If a requirement below is not met, the client degrades to an empty or locked state. It
never fabricates data, keys, trust signals or distances to cover a missing contract.

---

## 1. Tables and columns the client reads/writes

| Table | Columns used | Access | Notes |
| --- | --- | --- | --- |
| `profiles` | `id, handle, display_name, bio, age, neighborhood, privacy_setting, identity_public_key, reliability_score, verified_peers_count, safety_verified, location` | select (own + public fields of others), upsert (own) | `identity_public_key` must store the **P-256 JWK string** of the device identity. Never write a fingerprint into this column. `location` is written as a privacy-jittered point (see §5). |
| `intents` | `id, user_id, mode, intent, description, starts_at, expires_at, duration_label, travel_distance_label, travel_willingness, can_host, context, area, is_near_safe_haven, is_paused, location` | select (discovery + own), insert/update (own) | `is_paused = true` must hide the row from `discover_right_now`. There is **no `when_label`** column; the client derives the timing label from `starts_at` (see §4). |
| `gatherings` | `id, host_id, host_name, title, description, category, date_str, timestamp, location_name, address, neighborhood, is_safe_haven_venue, lat, lng, capacity, rsvp_count, tags, safety_guidelines` | select (all), insert (own) | `rsvp_count` must be the authoritative count. |
| `gathering_rsvps` | `gathering_id, user_id` | via `toggle_gathering_rsvp` | Capacity must be enforced server-side. |
| `profiles` | `id, handle, display_name, bio, age, neighborhood, privacy_setting, identity_public_key, reliability_score, verified_peers_count, safety_verified, location` + additive "About you" columns (`pronouns, height_cm, body_type, hobbies, boundaries, my_setup, availability`, all nullable, see `20261001090000_profile_about_you.sql`) | select (own + public fields of others), upsert (own) | `identity_public_key` must store the **P-256 JWK string** of the device identity. Never write a fingerprint into this column. `location` is written as a privacy-jittered point (see §5). `interests` holds the "What I'm looking for" chips (existing values reused as-is). The additive columns are the PUBLIC profile tier. |
| `profile_intimacy` | `user_id, intimacy_role, intimacy_prefs, intimacy_experience, intimacy_visibility, updated_at` | owner-only (RLS); read by others via `get_profile_intimacy` | SENSITIVE tier. `intimacy_visibility` ∈ `everyone \| connections \| private`, default `connections` (privacy-preserving — never public by default). **Must never be added to discovery RPC return lists.** |
| `messages` | `id, conversation_id, sender_id, ciphertext, nonce, created_at, expires_at, burned_at` | select/insert (members) | Stores ciphertext only. The client must be able to decrypt with the conversation key; it never receives a plaintext column. |
| `conversations`, `conversation_members` | `id, created_at`, `conversation_id, user_id` | select (own memberships) | Used to rebuild the Messages list on reload. Without read access the list is empty after a reload even though conversations exist. |
| `conversation_key_envelopes` | `conversation_id, user_id, device_id, wrapped_key, nonce, created_by_device_id` | upsert by `(conversation_id, device_id)` | The group-key delivery mechanism: the creator wraps the random conversation key for every member device. |
| `identity_devices` | `id, user_id, device_id, device_fingerprint, device_label, public_key, status, last_seen_at, revoked_at` | via RPCs | `public_key` = ECDH P-256 JWK of the device. |
| `safety_checkins` | `partner_name, venue_name, started_at, expires_at, notes` | select/insert (own) | Timer state must survive a reload. |
| `stories` | `id, author_id, display_name, intent, category, when_label, duration_hours, neighborhood, photo_url, created_at, expires_at` | select (all), insert (own) | `photo_url` stays `null` until a storage-backed upload exists. |
| `safe_havens` | `id, name, category, address, neighborhood, lat, lng, description, is_verified, amenities, hours` | select (all) | |
| `interests`, `gazes` | via RPCs | | |

## 2. RPCs

| RPC | Parameters | Must return |
| --- | --- | --- |
| `discover_right_now` | `p_radius_m`, `p_mode` (nullable), `p_intent` (nullable) | `intent_id, user_id, display_name, age, bio, avatar_path, neighborhood, mode, intent, description, expires_at, distance_m, map_lat, map_lng, reliability_score, verified_peers_count, safety_verified, travel_distance_label, can_host, travel_willingness` |
| `submit_interest` | `p_to_user`, `p_intent_id` | `{ conversation_id, matched }` |
| `toggle_gathering_rsvp` | `p_gathering_id` | `boolean` (new attending state); rejects when full |
| `get_profile_intimacy` | `p_user_id` | `intimacy_role, intimacy_prefs, intimacy_experience, intimacy_visibility` — **only when visibility allows** (owner always; `everyone` to all; `connections` only to users sharing a conversation via `get_my_conversations()`; `private` to nobody else). SECURITY DEFINER; `execute` granted to `authenticated` only. |
| `get_conversation_peer_key` | `p_conversation_id` | `peer_public_key` (JWK string) for a **direct** conversation |
| `get_conversation_peer_devices` | `p_conversation_id` | `user_id, device_id, public_key, device_label, last_seen_at` |
| `register_identity_device` | `p_fingerprint, p_public_key, p_device_label, p_signing_public_key, p_device_id` | inserted row |
| `revoke_identity_device` | `p_device_id` | — |
| `verify_peer_identity` | `p_peer_public_key, p_peer_fingerprint, p_device_id` | verification result |

`map_lat` / `map_lng` are the **privacy-jittered** published coordinates. `distance_m` is
measured server-side against the caller's stored (already jittered) location.

## 3. Group conversations — remaining backend work

The client already contains everything needed to use a group key safely:

* `createConversationKey()` — random AES-GCM-256 conversation key,
* `wrapConversationKey(conversationId, key, peerDevicePublicKeyJwk)` / `unwrapConversationKey(...)` —
  ECDH P-256 + AES-GCM envelope sealing,
* `listConversationKeyEnvelopes()` / `saveConversationKeyEnvelope()`,
* `get_conversation_peer_devices()`.

What does **not** exist yet is the ability to create a group conversation itself:

1. An insert path for `conversations` (a `kind` column or equivalent to distinguish
   `direct` from `group`).
2. An insert path for `conversation_members` covering every attending user, and a policy
   that lets a conversation owner add members but nobody else.
3. A defined link between a gathering and its conversation (e.g. `conversations.gathering_id`)
   so "Group Room" can open the right thread instead of guessing.
4. RLS on `conversation_key_envelopes` that allows a **member device** to insert an
   envelope row for **another member device of the same conversation** (that is what
   `created_by_device_id` is for). Without this, the first device cannot provision the key
   for the others and the conversation stays locked — the client says so instead of
   sending unencrypted messages.

Until (1)–(4) exist, the Later view shows "Group chat not available yet" and the Messages
list only shows real direct conversations. **Do not weaken RLS to work around this**: the
conversation key must never be readable by the backend.

## 4. Timing label

`intents.when_label` does not exist. Adding it (values `Now`, `Next 1 hour`,
`Next 2 hours`, `Tonight`) would let the composer round-trip the exact label the user
chose. Until then the client derives the label from `starts_at`.

## 5. Privacy invariants

* Exact device GPS must never be published. The client jitters before writing:
  300 m radius for intent/discovery positions (`DISCOVERY_JITTER_METERS`), 500 m for the
  `fuzzy_500m` privacy setting, 800 m for `neighborhood`. Ghost mode writes no location
  and clears the stored point.
* `discover_right_now` must not return the caller's own row (the client also filters it).
* Expired rows (`expires_at <= now()`) and paused rows must never appear in discovery.
* Reliability and verification counters are backend-owned; the client never writes them.
* **Travel distance is capped at 5 km.** `p_radius_m` must be clamped to
  `100..5000`; a 10 km, 25 km, negative, `NaN` or `Infinity` request must never
  widen the search beyond 5000 m. The clamp helper
  `public.clamp_discovery_radius_m(double precision)` ships in
  `supabase/migrations/20260930090000_discover_right_now_radius_cap.sql` and is
  covered by `npm run test:discovery`.

  That migration is **additive only** — it creates the helper and deliberately
  does *not* touch `discover_right_now`, because the live function's DDL is not
  checked into this repository and re-creating it from this document would risk
  removing production behaviour. Wiring the clamp into the live function is a
  separate operator step: `supabase/pending/discover_right_now_radius_cap.recipe.sql`.
  Until that step is applied the ceiling is enforced client-side only
  (`src/config/mapDefaults.ts`).

## 6. Edge functions

* `verify-device-signature` — used by `verifyCurrentDevice()` for device authenticity
  proof. Absence is reported as "device registry unavailable" and never blocks sign-in.

## 7. Storage (not yet used)

Stories and chat attachments carry `photo_url` / media payloads only as data URLs from
the local device. A Supabase Storage bucket (e.g. `story-media`, `chat-media`) with
per-user write policies and signed read URLs is required before real media upload is
wired up. Until then the UI never renders a remote image it did not receive as real data.
