# TURN credential investigation and client contract

2026-09-30 — **production expiry cannot currently be certified**. Cloudflare TURN is retained. No replacement TURN server/function/provider has been created or deployed.

## What was inspected

- Current tracked source, Supabase function/import/configuration files, migrations, `.env.example`, Cloudflare `wrangler.toml`, build/deploy workflows and existing documentation.
- Available Git history/ref trees for the function/configuration paths, without switching branches.
- Read-only GitHub branch/tree inspection of all ten branches returned by the repository API: `agents/continue-conversation-flow`, `agents/pasted-text-processing`, the five listed `arena/*` branches, `feat/notification-reminder`, `fix/profile-chat-pass` and `main`.
- No `webrtc-ice-servers` function source or separate TURN implementation was found. A tracked-content search for `webrtc-ice-servers`, `rtc.live.cloudflare`, `turn.cloudflare` and `generate-ice-servers` at HEAD identified only the existing WebRTC client.
- GitHub Actions variable/secret **metadata** requests returned HTTP 403, “Resource not accessible by integration.” Values were not requested or recovered. There is no evidence from that denied access about the actual production configuration.
- Earlier **push** sender source was found on project branches; that is unrelated to TURN and does not certify this function.

Cloudflare Worker hosting configuration is for the static GAYZE app. It does not contain the Supabase-hosted TURN credential function or prove the TURN provider's credential lifetime. Supabase's checked-in `config.toml` configures `send-push`, not `webrtc-ice-servers`.

## What is known from the client

The client invokes the existing Supabase function named `webrtc-ice-servers`, using the existing authenticated Supabase client, with `{}` as its body and a ten-second abort deadline. Its runtime result supplies ICE servers to `RTCPeerConnection`. The public fallback remains Cloudflare/Google STUN. No static TURN credentials or coturn path was added.

**The following is the client's supported contract, NOT a recovered description of deployed server behavior:**

```ts
{
  iceServers: Array<{
    urls: string | string[]; // stun:, stuns:, turn:, turns:
    username?: string;     // nonempty string required for TURN
    credential?: string;   // nonempty temporary string required for TURN
  }>;
  expiresAt?: number | string;  // epoch seconds/milliseconds or ISO timestamp
  expires_at?: number | string; // supported alias
  ttlSeconds?: number;          // positive seconds relative to request start
  ttl?: number;                 // supported alias
}
```

Only browser ICE fields are retained; provider-only response metadata is discarded. Empty/malformed ICE lists, invalid relay credentials and credentials expiring within five seconds are rejected with generic errors, not echoed secret values.

With known expiry, refresh happens 20% of TTL before expiry, capped at 60 seconds early. Requests coalesce and are call-generation scoped. Without expiry metadata, responses are not reused across negotiations; active calls revalidate every 30 seconds. **Thirty-second revalidation cannot prove refresh precedes an unknown real lifetime.** A failed fetch does not permanently cache STUN-only fallback.

Before restarting ICE, the client installs refreshed servers. The original caller creates a new restart offer; the callee requests restart and sends the answer. Both use existing Supabase signalling. Candidate username-fragment buffering, acknowledgement handling, bounded restart watchdogs and stale-call cleanup remain tested. No chat/TURN architecture substitution was made.

## Verified locally

- Epoch-second, epoch-millisecond, numeric-string, ISO, `expires_at`, `ttlSeconds` and `ttl` normalization.
- Early refresh boundary, concurrent fetch deduplication, missing-TTL non-reuse, failed fetch recovery and generation invalidation.
- Rejection of malformed/expired TURN responses and omission of provider-only metadata without secret echo.
- Caller/callee restart offer/answer flow, refreshed configuration, candidate-generation handling, failed acknowledgements, stale peer/startup/hangup isolation and bounded transient signalling.
- Public STUN fallback contains no credentials. Public TURN credential environment variables fail before bundling; the test sentinel does not enter output/logs.

These tests use the real client implementation and mocked function/signalling boundaries. They do not call a production TURN service or certify ICE behavior on physical networks.

## Precisely what is missing

A trusted project operator needs to recover and inspect, without posting credentials in chat:

1. The actual deployed `webrtc-ice-servers` source/version and project/function deployment configuration. A read-only Supabase function download from the correct authenticated operator environment is appropriate; it was not possible from the repository alone here.
2. The function's JWT/authorization checks, caller/session handling, CORS/rate limits and deployed `verify_jwt` setting.
3. Its Cloudflare TURN key identifier, provider API credential **location and permissions**, and requested TTL. Environment variable names are unknown until the real source/configuration is recovered; this report does not invent them.
4. The exact sanitized response structure and expiry units, whether the provider/function caches credentials, issuance/expiry clock behavior and minimum/maximum TTL.
5. The actual ICE URL set/transports and supported UDP, TCP and TLS/443 relay paths. Public STUN URLs do not prove relay-only connectivity.
6. A real authenticated request/refresh/expiry test, plus relay-only calls while expiring credentials and switching Wi-Fi/mobile networks on physical iOS/PWA devices. Unauthorized requests must fail; provider secrets must remain server-only.

Only after those checks can production credential expiry, refresh timing and client/server compatibility be certified. **This remains a release gate, not a fabricated server implementation.**
