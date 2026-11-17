# SECURITY DEFINER audit

Read from the live project (`qdewyupsqmtonkloqxsh`) on 16 Nov 2026 with read-only queries. Every function body was read; nothing was assumed safe because it is in a migration. Changes proposed here are **not applied**.

## Count

| | Advisor | This document |
|---|---|---|
| SECURITY DEFINER functions executable by `anon` | 10 | 10 |
| SECURITY DEFINER functions executable by `authenticated` (includes the anon ones) | 85 | 85 |

The advisor counts each overload separately: `register_voip_token` (2), `submit_interest` (2) and PostGIS `st_estimatedextent` (3) each appear once per signature below. Three of the 85 are owned by the PostGIS extension, not by GAYZE.

Risk: **3 high** (all three signatures of one PostGIS function), **5 medium**, **77 low**.

## Findings that need a decision (highest first)

1. **st_estimatedextent** (high; three signatures, one function). PostGIS function owned by `supabase_admin`, SECURITY DEFINER, executable by `anon`, no fixed `search_path`, no caller check. It answers from planner statistics, so row security does not apply. Probed on live as `anon`: `st_estimatedextent('public','profiles','location')` returns a bounding box (probe confirmed a non-null result; the box itself was read as `postgres`). It covers the stored profile points, so a signed-out caller learns the outer edge of where members are. Stored points are fogged to 500 m cells, and for today's test data the box is about 90 m by 80 m.
   - Action: Revoke EXECUTE from `anon` and `authenticated`: not possible from the migration role (the function is extension-owned and `postgres` has no grant option). Candidate fix, **untested** because PGlite has no PostGIS: `alter table public.profiles alter column location set statistics 0; analyze public.profiles;`, repeated for `intents` and `safe_havens`, which should leave no statistics to read; the cost is that the planner loses spatial row estimates (irrelevant at this size). Test on a Supabase branch first, or ask Supabase support to revoke the function.

2. **discover_people** (medium). Signed-in. Filters: 18+, not blocked, discoverable, not suspended, not ghost. Returns distance rounded up to whole km. `p_radius_km` plus a caller-controlled own location works as a distance oracle against any discoverable member who is not `neighborhood`-private. No rate limit.
   - Action: Keep. Consider rate limiting and bucketing `p_radius_km`, and snapping the caller's own origin. Already noted in docs/LOCATION_FOG.md.

3. **discover_right_now** (medium). Wrapper over `private.discover_right_now`, which reads `auth.uid()`; a signed-out call matches nothing (and anon has no EXECUTE). Distance banded to 250 m, map point is the fogged cell. Does not exclude suspended accounts or enforce the 18+ rule that `discover_people` enforces.
   - Action: Add the suspended and age filters used by `discover_people`. Changes behaviour.

4. **get_profile_intimacy** (medium). Caller can be anyone signed in. Row returned if it is your own, or visibility is `everyone`, or `connections` and you share a chat. The `everyone` branch has no block, ghost, discoverable, suspension or age check.
   - Action: Add the same gates as `get_public_profile_summary` (not blocked, not suspended, ghost/discoverable) to the `everyone` branch. Changes behaviour, so not done here.

5. **reliability_summary** (medium). Signed-in. Any `p_user` is accepted; only a block check. No relationship or discoverability check, so another member's reliability score, cancelled-en-route count and verified-meet count are returned for a non-discoverable or ghost member.
   - Action: Require a shared chat or the same visibility rule as `get_public_profile_summary`. Changes behaviour.

6. **request_to_join_gathering** (medium). Signed-in. Any gathering id. No block check against the host, so a blocked member can still request to join and appear in the host's pending list.
   - Action: Refuse when `gayze_is_blocked_between(host_id)`. Changes behaviour.

7. **gayze_album_share_ok** (low). Takes the viewer as a parameter (`p_viewer`), so any signed-in caller can ask whether a given member may view a given share id (a boolean; share ids are unguessable uuids). Used only inside two other SECURITY DEFINER functions; no policy references it (checked on live).
   - Action: Revoke EXECUTE from `authenticated` (callers run as the owner and do not need it).

## PostGIS in `public` and `spatial_ref_sys`

Both advisor items remain after this work, by design:

- **`extension_in_public`**: PostGIS 3.3.7 is not relocatable (`extrelocatable = false`), and it and `spatial_ref_sys` are owned by `supabase_admin`. The migration role (`postgres`) is not a superuser and not a member of that role, so `ALTER EXTENSION postgis SET SCHEMA` cannot run. Forcing a move would also have to cope with three `geography(Point,4326)` columns (`profiles`, `intents`, `safe_havens`), their three GiST indexes, and the three functions that use PostGIS types or functions unqualified: `discover_people`, `private.discover_right_now` and `private.fog_snap`. A text search for `st_`/`geography` matched about 40 other functions, but only on unrelated names such as `st_id` and `last_seen_at`. Their `search_path` settings all include `public`, which is where the extension sits. Dropping the extension would drop the geography columns and their data. Not attempted.
- **`rls_disabled_in_public` on `spatial_ref_sys`**: the table is owned by `supabase_admin`, so row security cannot be enabled by this role. Writes by `anon` and `authenticated` are already refused by the `gayze_block_api_writes` triggers (20261108210000). `20261116210100_postgis_reference_table_writes.sql` removes the write privileges where the executing role owns the grant; on the hosted project it does not (postgres holds no grant option), and it says so in a notice. It is separate so it can be rejected. The advisor warning will stay until Supabase changes the table's owner or exposes the schema differently.
- **Reference-table reads must stay**: PostGIS reads `spatial_ref_sys` as the calling role when validating or transforming an SRID.

## Table of all functions

Sorted by risk, then name. `search_path` is as stored on the function.

| # | Function | Callable by | Checks caller identity | search_path | Risk | Recommended action |
|---|---|---|---|---|---|---|
| 1 | `st_estimatedextent(text, text)` | anon, authenticated | no | extension-owned, none set | high | See finding above |
| 2 | `st_estimatedextent(text, text, text)` | anon, authenticated | no | extension-owned, none set | high | See finding above |
| 3 | `st_estimatedextent(text, text, text, boolean)` | anon, authenticated | no | extension-owned, none set | high | See finding above |
| 4 | `discover_people(p_interests text[], p_query text, p_radius_km integer, p_limit integer, p_offset integer)` | authenticated | yes | `public, pg_temp` | medium | See finding above |
| 5 | `discover_right_now(p_radius_m integer, p_mode text, p_intent text, p_activity text)` | authenticated | via wrapper | `public, private` | medium | See finding above |
| 6 | `get_profile_intimacy(p_user_id uuid)` | authenticated | yes | `public` | medium | See finding above |
| 7 | `reliability_summary(p_user uuid)` | authenticated | yes | `public, pg_temp` | medium | See finding above |
| 8 | `request_to_join_gathering(p_gathering_id uuid)` | authenticated | yes | `public, pg_temp` | medium | See finding above |
| 9 | `accept_interest(p_interest_id uuid)` | authenticated | yes | `public, private` | low | Keep |
| 10 | `call_ring_reach(p_callee uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 11 | `cancel_scheduled_message(p_message_id uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 12 | `claim_conversation_key_bootstrap(p_conversation_id uuid, p_device_id uuid, p_key_version integer)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 13 | `decline_interest(p_interest_id uuid)` | authenticated | yes | `public, private` | low | Keep |
| 14 | `delete_message_for_me(p_message_id uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 15 | `drop_other_voip_tokens(p_keep_device text)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 16 | `end_call_session(p_call_id uuid, p_status text)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 17 | `gayze_album_share_ok(p_share_id uuid, p_viewer uuid)` | authenticated | n/a | `public, pg_temp` | low | Revoke EXECUTE from `authenticated` (callers run as the owner and do not need it) |
| 18 | `gayze_call_notification(p_conversation uuid, p_recipient uuid, p_call_id uuid, p_call_type text, p_category text)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 19 | `gayze_can_view_album_object(p_name text)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 20 | `gayze_can_view_profile_media(p_owner text)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 21 | `gayze_can_view_shared_interest_photo(p_storage_path text)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 22 | `gayze_connection_notification(p_conversation uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 23 | `gayze_is_blocked_between(p_peer_id uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 24 | `gayze_mark_all_notifications_read()` | authenticated | yes | `public, pg_temp` | low | Keep |
| 25 | `gayze_mark_notification_read(p_id uuid, p_conversation uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 26 | `gayze_pre_request()` | anon, authenticated | JWT subject | `public, pg_temp` | low | Keep |
| 27 | `get_call_signal(p_call_id uuid, p_kind text, p_after bigint)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 28 | `get_call_status(p_call_id uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 29 | `get_conversation_member_devices(p_conversation_id uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 30 | `get_conversation_peer_devices(p_conversation_id uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 31 | `get_conversation_peer_key(p_conversation_id uuid)` | authenticated | yes | `public, private` | low | Keep |
| 32 | `get_gathering_hosts(p_ids uuid[])` | authenticated | yes | `public, pg_temp` | low | Keep |
| 33 | `get_gathering_places(p_ids uuid[])` | authenticated | yes | `public, pg_temp` | low | Keep |
| 34 | `get_gathering_rsvp_overview(p_ids uuid[])` | authenticated | yes | `public, pg_temp` | low | Keep |
| 35 | `get_incoming_interest_profiles()` | authenticated | yes | `public, pg_temp` | low | Keep |
| 36 | `get_my_conversations()` | authenticated | yes | `\\` | low | Keep |
| 37 | `get_my_gathering_chats()` | authenticated | yes | `public, pg_temp` | low | Keep |
| 38 | `get_my_notices(p_limit integer)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 39 | `get_my_past_meets()` | authenticated | yes | `public, pg_temp` | low | Keep |
| 40 | `get_peer_intent(p_peer_id uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 41 | `get_peers_live_intents(p_peer_ids uuid[])` | authenticated | yes | `public, pg_temp` | low | Keep |
| 42 | `get_presence(p_user_ids uuid[])` | authenticated | yes | `public, pg_temp` | low | Keep |
| 43 | `get_public_profile_summary(p_user_id uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 44 | `get_ringing_call()` | authenticated | yes | `public, pg_temp` | low | Keep |
| 45 | `get_shared_album(p_share_id uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 46 | `issue_meet_qr()` | authenticated | yes | `public, pg_temp` | low | Keep |
| 47 | `issue_native_call_key(p_device text)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 48 | `leave_conversation(p_conversation_id uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 49 | `leave_gathering(p_gathering_id uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 50 | `link_album_share_message(p_share_id uuid, p_message_id uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 51 | `list_album_shares(p_album_id uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 52 | `log_call_event(p_call_id uuid, p_event text)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 53 | `mark_notices_read(p_ids uuid[])` | authenticated | yes | `public, pg_temp` | low | Keep |
| 54 | `my_account_status()` | authenticated | JWT subject | `public, pg_temp` | low | Keep |
| 55 | `native_call_answer(p_call_id uuid, p_key text)` | anon, authenticated | key hash | `public, pg_temp` | low | Keep |
| 56 | `native_call_end(p_call_id uuid, p_key text)` | anon, authenticated | key hash | `public, pg_temp` | low | Keep |
| 57 | `native_call_get_signal(p_call_id uuid, p_key text, p_kind text, p_after bigint)` | anon, authenticated | key hash | `public, pg_temp` | low | Keep |
| 58 | `native_call_log(p_call_id uuid, p_key text, p_event text)` | anon, authenticated | key hash | `public, pg_temp` | low | Keep |
| 59 | `native_call_post_signal(p_call_id uuid, p_key text, p_kind text, p_payload jsonb)` | anon, authenticated | key hash | `public, pg_temp` | low | Keep |
| 60 | `native_call_status(p_call_id uuid, p_key text)` | anon, authenticated | key hash | `public, pg_temp` | low | Keep |
| 61 | `post_call_signal(p_call_id uuid, p_to uuid, p_kind text, p_payload jsonb)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 62 | `presence_heartbeat(p_status text)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 63 | `redeem_meet_qr(p_token text)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 64 | `register_identity_device(p_fingerprint text, p_public_key text, p_device_label text, p_signing_public_key text, p_device_id uuid)` | authenticated | yes | `public, private` | low | Keep |
| 65 | `register_voip_token(p_token text, p_environment text)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 66 | `register_voip_token(p_token text, p_environment text, p_device text)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 67 | `report_meet_cancel(p_peer uuid, p_meeting text, p_reason text)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 68 | `respond_to_gathering_request(p_gathering_id uuid, p_user_id uuid, p_accept boolean)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 69 | `revoke_album_share(p_share_id uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 70 | `revoke_identity_device(p_device_id uuid)` | authenticated | yes | `public, private` | low | Keep |
| 71 | `revoke_native_call_key(p_device text)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 72 | `revoke_past_meet(p_peer uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 73 | `save_conversation_key_envelope(p_conversation_id uuid, p_user_id uuid, p_device_id uuid, p_wrapped_key text, p_nonce text, p_created_by_device_id uuid, p_key_version integer)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 74 | `schedule_encrypted_message(p_conversation_id uuid, p_ciphertext text, p_nonce text, p_scheduled_for timestamp with time zone, p_client_message_id text, p_expires_at timestamp with time zone)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 75 | `set_chats_archived(p_ids uuid[], p_archived boolean)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 76 | `set_message_expiry(p_message_id uuid, p_expires_at timestamp with time zone)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 77 | `set_open_to_more(p_enabled boolean)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 78 | `share_album(p_album_id uuid, p_conversation_id uuid, p_expires_at timestamp with time zone)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 79 | `start_call_session(p_call_id uuid, p_conversation uuid, p_callee uuid, p_call_type text)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 80 | `submit_interest(p_to_user uuid, p_intent_id uuid)` | authenticated | n/a | `public, private` | low | Keep |
| 81 | `submit_interest(p_to_user uuid, p_intent_id uuid, p_message text, p_shared_photo_ids uuid[])` | authenticated | yes | `public, private` | low | Keep |
| 82 | `toggle_gathering_rsvp(p_gathering_id uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 83 | `unregister_voip_token(p_token text)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 84 | `unsend_message(p_message_id uuid)` | authenticated | yes | `public, pg_temp` | low | Keep |
| 85 | `verify_peer_identity(p_peer_public_key text, p_peer_fingerprint text, p_device_id uuid)` | authenticated | yes | `public, private, pg_temp` | low | Keep; require a shared chat if the count is ever shown as a trust signal |

## Detail by function

What each function checks, in the same order.

1. **`st_estimatedextent(text, text)`**: None. PostGIS function owned by `supabase_admin`, SECURITY DEFINER, no fixed search_path. Reads planner statistics, so row security does not apply. Probed on live as `anon`: `st_estimatedextent('public','profiles','location')` returns a bounding box for all 12 stored profile locations.
2. **`st_estimatedextent(text, text, text)`**: None. PostGIS function owned by `supabase_admin`, SECURITY DEFINER, no fixed search_path. Reads planner statistics, so row security does not apply. Probed on live as `anon`: `st_estimatedextent('public','profiles','location')` returns a bounding box for all 12 stored profile locations.
3. **`st_estimatedextent(text, text, text, boolean)`**: None. PostGIS function owned by `supabase_admin`, SECURITY DEFINER, no fixed search_path. Reads planner statistics, so row security does not apply. Probed on live as `anon`: `st_estimatedextent('public','profiles','location')` returns a bounding box for all 12 stored profile locations.
4. **`discover_people(p_interests text[], p_query text, p_radius_km integer, p_limit integer, p_offset integer)`**: Signed-in. Filters: 18+, not blocked, discoverable, not suspended, not ghost. Returns distance rounded up to whole km. `p_radius_km` plus a caller-controlled own location works as a distance oracle against any discoverable member who is not `neighborhood`-private. No rate limit.
5. **`discover_right_now(p_radius_m integer, p_mode text, p_intent text, p_activity text)`**: Wrapper over `private.discover_right_now`, which reads `auth.uid()`; a signed-out call matches nothing (and anon has no EXECUTE). Distance banded to 250 m, map point is the fogged cell. Does not exclude suspended accounts or enforce the 18+ rule that `discover_people` enforces.
6. **`get_profile_intimacy(p_user_id uuid)`**: Caller can be anyone signed in. Row returned if it is your own, or visibility is `everyone`, or `connections` and you share a chat. The `everyone` branch has no block, ghost, discoverable, suspension or age check.
7. **`reliability_summary(p_user uuid)`**: Signed-in. Any `p_user` is accepted; only a block check. No relationship or discoverability check, so another member's reliability score, cancelled-en-route count and verified-meet count are returned for a non-discoverable or ghost member.
8. **`request_to_join_gathering(p_gathering_id uuid)`**: Signed-in. Any gathering id. No block check against the host, so a blocked member can still request to join and appear in the host's pending list.
9. **`accept_interest(p_interest_id uuid)`**: Only the recipient (`to_user_id = auth.uid()`) of a pending interest; row locked.
10. **`call_ring_reach(p_callee uuid)`**: Caller must be on the call. Starting needs a shared chat, an accepted GAYZE and no block (tested in scripts/privacy-tests/call-gating.test.mjs). Mailbox rows are limited to the two participants, 40 per sender per call, 24 000 characters.
11. **`cancel_scheduled_message(p_message_id uuid)`**: Own messages or own membership (`sender_id = auth.uid()` or member check).
12. **`claim_conversation_key_bootstrap(p_conversation_id uuid, p_device_id uuid, p_key_version integer)`**: Caller must be a conversation member; the target device must be an active device of a member; the creator device must be the caller's own active device. Wrapped keys are opaque to the server.
13. **`decline_interest(p_interest_id uuid)`**: Only the recipient (`to_user_id = auth.uid()`) of a pending interest; row locked.
14. **`delete_message_for_me(p_message_id uuid)`**: Own messages or own membership (`sender_id = auth.uid()` or member check).
15. **`drop_other_voip_tokens(p_keep_device text)`**: Own tokens only.
16. **`end_call_session(p_call_id uuid, p_status text)`**: Caller must be on the call. Starting needs a shared chat, an accepted GAYZE and no block (tested in scripts/privacy-tests/call-gating.test.mjs). Mailbox rows are limited to the two participants, 40 per sender per call, 24 000 characters.
17. **`gayze_album_share_ok(p_share_id uuid, p_viewer uuid)`**: Takes the viewer as a parameter (`p_viewer`), so any signed-in caller can ask whether a given member may view a given share id (a boolean; share ids are unguessable uuids). Used only inside two other SECURITY DEFINER functions; no policy references it (checked on live).
18. **`gayze_call_notification(p_conversation uuid, p_recipient uuid, p_call_id uuid, p_call_type text, p_category text)`**: Signed-in; caller and recipient must both be in the conversation. No accepted-GAYZE or block check; blocked recipients are dropped by the notification trigger.
19. **`gayze_can_view_album_object(p_name text)`**: Uses `auth.uid()` and the relationship tables (block, shared chat, interest, live intent, share). Used by storage and table policies.
20. **`gayze_can_view_profile_media(p_owner text)`**: Uses `auth.uid()` and the relationship tables (block, shared chat, interest, live intent, share). Used by storage and table policies.
21. **`gayze_can_view_shared_interest_photo(p_storage_path text)`**: Uses `auth.uid()` and the relationship tables (block, shared chat, interest, live intent, share). Used by storage and table policies.
22. **`gayze_connection_notification(p_conversation uuid)`**: Uses `auth.uid()` and the relationship tables (block, shared chat, interest, live intent, share). Used by storage and table policies.
23. **`gayze_is_blocked_between(p_peer_id uuid)`**: Uses `auth.uid()`; answers only about pairs including the caller.
24. **`gayze_mark_all_notifications_read()`**: Own rows only (`user_id = auth.uid()`).
25. **`gayze_mark_notification_read(p_id uuid, p_conversation uuid)`**: Own rows only (`user_id = auth.uid()`).
26. **`gayze_pre_request()`**: Callable by `anon` on purpose: PostgREST runs it as the request role before every call. Reads the JWT subject and raises `account_suspended`. Returns nothing otherwise.
27. **`get_call_signal(p_call_id uuid, p_kind text, p_after bigint)`**: Caller must be on the call. Starting needs a shared chat, an accepted GAYZE and no block (tested in scripts/privacy-tests/call-gating.test.mjs). Mailbox rows are limited to the two participants, 40 per sender per call, 24 000 characters.
28. **`get_call_status(p_call_id uuid)`**: Caller must be on the call. Starting needs a shared chat, an accepted GAYZE and no block (tested in scripts/privacy-tests/call-gating.test.mjs). Mailbox rows are limited to the two participants, 40 per sender per call, 24 000 characters.
29. **`get_conversation_member_devices(p_conversation_id uuid)`**: Caller must be a member of the conversation. Returns public keys and device labels only (no private key material).
30. **`get_conversation_peer_devices(p_conversation_id uuid)`**: Caller must be a member of the conversation. Returns public keys and device labels only (no private key material).
31. **`get_conversation_peer_key(p_conversation_id uuid)`**: Caller must be a member of the conversation. Returns public keys and device labels only (no private key material).
32. **`get_gathering_hosts(p_ids uuid[])`**: Signed-in; excludes blocked pairs. Gatherings are visible to all signed-in members by policy (`gatherings visible to authenticated users`), so host name, avatar and verified flag are no more than that.
33. **`get_gathering_places(p_ids uuid[])`**: Signed-in; exact place returned only to the host or an attending member.
34. **`get_gathering_rsvp_overview(p_ids uuid[])`**: Signed-in; any gathering returns an attending count and the caller's own status. Pending requests only to the host; attendee names only to the host or attendees.
35. **`get_incoming_interest_profiles()`**: Own pending incoming interests only (`i.to_user_id = auth.uid()`).
36. **`get_my_conversations()`**: Rows only for chats the caller belongs to; hides chats with a blocked peer. `search_path` is empty.
37. **`get_my_gathering_chats()`**: Chats the caller belongs to.
38. **`get_my_notices(p_limit integer)`**: Own rows only (`user_id = auth.uid()`).
39. **`get_my_past_meets()`**: Own past meets; excludes blocked peers.
40. **`get_peer_intent(p_peer_id uuid)`**: Signed-in; requires a shared chat with the member, not blocked, live and not paused.
41. **`get_peers_live_intents(p_peer_ids uuid[])`**: Signed-in; requires a shared chat with the member, not blocked, live and not paused.
42. **`get_presence(p_user_ids uuid[])`**: Signed-in; per member: self, or online-status sharing on, not blocked, and discoverable or a shared chat. At most 100 ids.
43. **`get_public_profile_summary(p_user_id uuid)`**: Signed-in; own profile, or 18+, not blocked, not suspended, and shared chat or (not ghost and discoverable). Returns profile fields only; no location.
44. **`get_ringing_call()`**: Caller must be on the call. Starting needs a shared chat, an accepted GAYZE and no block (tested in scripts/privacy-tests/call-gating.test.mjs). Mailbox rows are limited to the two participants, 40 per sender per call, 24 000 characters.
45. **`get_shared_album(p_share_id uuid)`**: Signed-in. Recipient must hold an active share (`gayze_album_share_ok`), or the caller must own the album or share; sharing needs a two-person chat, no block.
46. **`issue_meet_qr()`**: Signed-in; token stored as a hash, 90 s expiry, rate limits, self-redeem and blocked or suspended members refused; `report_meet_cancel` and `revoke_past_meet` only touch the caller's own reliability rows.
47. **`issue_native_call_key(p_device text)`**: Own keys only (`auth.uid()`). The key is returned once and stored hashed.
48. **`leave_conversation(p_conversation_id uuid)`**: Own messages or own membership (`sender_id = auth.uid()` or member check).
49. **`leave_gathering(p_gathering_id uuid)`**: Own RSVP, or host only for responses.
50. **`link_album_share_message(p_share_id uuid, p_message_id uuid)`**: Signed-in. Recipient must hold an active share (`gayze_album_share_ok`), or the caller must own the album or share; sharing needs a two-person chat, no block.
51. **`list_album_shares(p_album_id uuid)`**: Signed-in. Recipient must hold an active share (`gayze_album_share_ok`), or the caller must own the album or share; sharing needs a two-person chat, no block.
52. **`log_call_event(p_call_id uuid, p_event text)`**: Caller must be on the call. Starting needs a shared chat, an accepted GAYZE and no block (tested in scripts/privacy-tests/call-gating.test.mjs). Mailbox rows are limited to the two participants, 40 per sender per call, 24 000 characters.
53. **`mark_notices_read(p_ids uuid[])`**: Own rows only (`user_id = auth.uid()`).
54. **`my_account_status()`**: Reads only the JWT subject; returns `suspended` or `active` for the caller.
55. **`native_call_answer(p_call_id uuid, p_key text)`**: Callable by `anon` on purpose. Identity comes from `private.native_call_user(p_key)`: key must match `^gck1\.[0-9a-f]{64}$` and its SHA-256 must equal a stored `key_hash`. A wrong or malformed key resolves to NULL and every function returns nothing or `not_on_call`. Then each checks the caller is on that call. Verified on live as `anon` with a well-formed wrong key and a malformed key: answer null, end/log no-op, get_signal 0 rows, status null, post_signal `not_on_call`; `private.native_call_user` and `native_call_keys` are not reachable by anon. Key is two `gen_random_uuid()` values (about 240 bits), stored hashed, one per user and device, rotated on re-issue, revoked on sign-out.
56. **`native_call_end(p_call_id uuid, p_key text)`**: Callable by `anon` on purpose. Identity comes from `private.native_call_user(p_key)`: key must match `^gck1\.[0-9a-f]{64}$` and its SHA-256 must equal a stored `key_hash`. A wrong or malformed key resolves to NULL and every function returns nothing or `not_on_call`. Then each checks the caller is on that call. Verified on live as `anon` with a well-formed wrong key and a malformed key: answer null, end/log no-op, get_signal 0 rows, status null, post_signal `not_on_call`; `private.native_call_user` and `native_call_keys` are not reachable by anon. Key is two `gen_random_uuid()` values (about 240 bits), stored hashed, one per user and device, rotated on re-issue, revoked on sign-out.
57. **`native_call_get_signal(p_call_id uuid, p_key text, p_kind text, p_after bigint)`**: Callable by `anon` on purpose. Identity comes from `private.native_call_user(p_key)`: key must match `^gck1\.[0-9a-f]{64}$` and its SHA-256 must equal a stored `key_hash`. A wrong or malformed key resolves to NULL and every function returns nothing or `not_on_call`. Then each checks the caller is on that call. Verified on live as `anon` with a well-formed wrong key and a malformed key: answer null, end/log no-op, get_signal 0 rows, status null, post_signal `not_on_call`; `private.native_call_user` and `native_call_keys` are not reachable by anon. Key is two `gen_random_uuid()` values (about 240 bits), stored hashed, one per user and device, rotated on re-issue, revoked on sign-out.
58. **`native_call_log(p_call_id uuid, p_key text, p_event text)`**: Callable by `anon` on purpose. Identity comes from `private.native_call_user(p_key)`: key must match `^gck1\.[0-9a-f]{64}$` and its SHA-256 must equal a stored `key_hash`. A wrong or malformed key resolves to NULL and every function returns nothing or `not_on_call`. Then each checks the caller is on that call. Verified on live as `anon` with a well-formed wrong key and a malformed key: answer null, end/log no-op, get_signal 0 rows, status null, post_signal `not_on_call`; `private.native_call_user` and `native_call_keys` are not reachable by anon. Key is two `gen_random_uuid()` values (about 240 bits), stored hashed, one per user and device, rotated on re-issue, revoked on sign-out.
59. **`native_call_post_signal(p_call_id uuid, p_key text, p_kind text, p_payload jsonb)`**: Callable by `anon` on purpose. Identity comes from `private.native_call_user(p_key)`: key must match `^gck1\.[0-9a-f]{64}$` and its SHA-256 must equal a stored `key_hash`. A wrong or malformed key resolves to NULL and every function returns nothing or `not_on_call`. Then each checks the caller is on that call. Verified on live as `anon` with a well-formed wrong key and a malformed key: answer null, end/log no-op, get_signal 0 rows, status null, post_signal `not_on_call`; `private.native_call_user` and `native_call_keys` are not reachable by anon. Key is two `gen_random_uuid()` values (about 240 bits), stored hashed, one per user and device, rotated on re-issue, revoked on sign-out.
60. **`native_call_status(p_call_id uuid, p_key text)`**: Callable by `anon` on purpose. Identity comes from `private.native_call_user(p_key)`: key must match `^gck1\.[0-9a-f]{64}$` and its SHA-256 must equal a stored `key_hash`. A wrong or malformed key resolves to NULL and every function returns nothing or `not_on_call`. Then each checks the caller is on that call. Verified on live as `anon` with a well-formed wrong key and a malformed key: answer null, end/log no-op, get_signal 0 rows, status null, post_signal `not_on_call`; `private.native_call_user` and `native_call_keys` are not reachable by anon. Key is two `gen_random_uuid()` values (about 240 bits), stored hashed, one per user and device, rotated on re-issue, revoked on sign-out.
61. **`post_call_signal(p_call_id uuid, p_to uuid, p_kind text, p_payload jsonb)`**: Caller must be on the call. Starting needs a shared chat, an accepted GAYZE and no block (tested in scripts/privacy-tests/call-gating.test.mjs). Mailbox rows are limited to the two participants, 40 per sender per call, 24 000 characters.
62. **`presence_heartbeat(p_status text)`**: Writes the caller's own row.
63. **`redeem_meet_qr(p_token text)`**: Signed-in; token stored as a hash, 90 s expiry, rate limits, self-redeem and blocked or suspended members refused; `report_meet_cancel` and `revoke_past_meet` only touch the caller's own reliability rows.
64. **`register_identity_device(p_fingerprint text, p_public_key text, p_device_label text, p_signing_public_key text, p_device_id uuid)`**: Own devices only (`auth.uid()`); revoke also needs a device verification within five minutes.
65. **`register_voip_token(p_token text, p_environment text)`**: Signed-in. A token already registered to another account is moved to the caller (intended: same phone, new account). Needs the 64-hex device token.
66. **`register_voip_token(p_token text, p_environment text, p_device text)`**: Signed-in. A token already registered to another account is moved to the caller (intended: same phone, new account). Needs the 64-hex device token.
67. **`report_meet_cancel(p_peer uuid, p_meeting text, p_reason text)`**: Signed-in; token stored as a hash, 90 s expiry, rate limits, self-redeem and blocked or suspended members refused; `report_meet_cancel` and `revoke_past_meet` only touch the caller's own reliability rows.
68. **`respond_to_gathering_request(p_gathering_id uuid, p_user_id uuid, p_accept boolean)`**: Own RSVP, or host only for responses.
69. **`revoke_album_share(p_share_id uuid)`**: Signed-in. Recipient must hold an active share (`gayze_album_share_ok`), or the caller must own the album or share; sharing needs a two-person chat, no block.
70. **`revoke_identity_device(p_device_id uuid)`**: Own devices only (`auth.uid()`); revoke also needs a device verification within five minutes.
71. **`revoke_native_call_key(p_device text)`**: Own keys only (`auth.uid()`). The key is returned once and stored hashed.
72. **`revoke_past_meet(p_peer uuid)`**: Signed-in; token stored as a hash, 90 s expiry, rate limits, self-redeem and blocked or suspended members refused; `report_meet_cancel` and `revoke_past_meet` only touch the caller's own reliability rows.
73. **`save_conversation_key_envelope(p_conversation_id uuid, p_user_id uuid, p_device_id uuid, p_wrapped_key text, p_nonce text, p_created_by_device_id uuid, p_key_version integer)`**: Caller must be a conversation member; the target device must be an active device of a member; the creator device must be the caller's own active device. Wrapped keys are opaque to the server.
74. **`schedule_encrypted_message(p_conversation_id uuid, p_ciphertext text, p_nonce text, p_scheduled_for timestamp with time zone, p_client_message_id text, p_expires_at timestamp with time zone)`**: Own messages or own membership (`sender_id = auth.uid()` or member check).
75. **`set_chats_archived(p_ids uuid[], p_archived boolean)`**: Own messages or own membership (`sender_id = auth.uid()` or member check).
76. **`set_message_expiry(p_message_id uuid, p_expires_at timestamp with time zone)`**: Own messages or own membership (`sender_id = auth.uid()` or member check).
77. **`set_open_to_more(p_enabled boolean)`**: Writes the caller's own row.
78. **`share_album(p_album_id uuid, p_conversation_id uuid, p_expires_at timestamp with time zone)`**: Signed-in. Recipient must hold an active share (`gayze_album_share_ok`), or the caller must own the album or share; sharing needs a two-person chat, no block.
79. **`start_call_session(p_call_id uuid, p_conversation uuid, p_callee uuid, p_call_type text)`**: Caller must be on the call. Starting needs a shared chat, an accepted GAYZE and no block (tested in scripts/privacy-tests/call-gating.test.mjs). Mailbox rows are limited to the two participants, 40 per sender per call, 24 000 characters.
80. **`submit_interest(p_to_user uuid, p_intent_id uuid)`**: Signed-in; recipient privacy (`who_can_message`), intent ownership and shared-photo ownership checked; one request per pair.
81. **`submit_interest(p_to_user uuid, p_intent_id uuid, p_message text, p_shared_photo_ids uuid[])`**: Signed-in; recipient privacy (`who_can_message`), intent ownership and shared-photo ownership checked; one request per pair.
82. **`toggle_gathering_rsvp(p_gathering_id uuid)`**: Own RSVP, or host only for responses.
83. **`unregister_voip_token(p_token text)`**: Own tokens only.
84. **`unsend_message(p_message_id uuid)`**: Own messages or own membership (`sender_id = auth.uid()` or member check).
85. **`verify_peer_identity(p_peer_public_key text, p_peer_fingerprint text, p_device_id uuid)`**: Signed-in. Looks a profile up by public key; no shared-chat requirement. Writes only the caller's own verification rows and own `verified_peers_count`, so the count can be raised by verifying members whose keys the caller knows.

## Other schemas

- `private` has 11 SECURITY DEFINER functions. `authenticated` can execute three: `private.discover_right_now`, `private.user_conversation_ids` (used by the `conversation_members` read policy) and `private.call_live_status` (not definer). The schema is not exposed through the API, so none is callable as an RPC. `anon` has no usage on `private`.
- All 85 listed functions have a fixed `search_path` except the three PostGIS ones.

## Manual step (dashboard)

- **Leaked-password protection** (`auth_leaked_password_protection`): Supabase dashboard, Authentication, Policies / Sign In settings. Not a database setting; not changed here.
