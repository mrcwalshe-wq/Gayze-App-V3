# Migration history reconciliation (8 Nov 2026)

Production's ledger (`supabase_migrations.schema_migrations`) has 88 rows; the repository has 77 files. They disagree in both directions, so the repo alone cannot rebuild production.

## In the repo, not in the ledger (20)
Applied to production by pasting SQL, not through the ledger. The seven from the 6-8 Nov work were checked against production and their objects exist:

- `20261107120100_location_fog_apply`, `20261107140000_gathering_group_chat`, `20261107150000_gathering_rsvp_status_values`
- `20261108100000_intent_model_v2`, `20261108120000_discovery_activities`, `20261108130000_event_categories`, `20261108180000_quick_plan_intent_guard`

Older ones not re-verified: `20261005021000` call_push_type_key, `20261005022000` call_notification_read_scope, `20261005030000` message_lifecycle, `20261005040000` public_profile_album, `20261005095000` profile_preferences_fix, `20261007191000` interest_notifications, `20261009190000` harden_gayze_request_idempotency, `20261010200000` recover_recent_pending_gayzes, `20261010210000` align_received_gayze_notification_contract, `20261013230000` route_repeat_gayze_to_chat, `20261025111000` enable_pre_request, `20261025130000` record_push_runtime_secret_getter.

`20261108210000_security_hardening_round2` is new and not yet applied.

## In the ledger, not in the repo (31)
Applied through the dashboard/MCP under their own names (for example `gayze_backend_foundation`, `profile_photos`, `push_internal_dispatch_tokens`). Their SQL is not in this repository.

## Fix (do not replay anything against production)
1. `supabase db pull` against production to capture the real schema as one baseline migration.
2. `supabase migration repair --status applied <versions>` so the ledger matches.
3. From then on, apply changes only as migration files.
4. Prove it: create a Supabase branch from the repo and run the test suites against it.
