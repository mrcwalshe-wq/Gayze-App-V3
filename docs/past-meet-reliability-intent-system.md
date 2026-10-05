# GAYZE Past Meet, QR, Reliability & Intent Visibility System

**Status:** Product specification / implementation contract  
**Scope:** QR-confirmed Past Meets, current Intent visibility, reliability scoring, proposal-meeting follow-up notifications, and GAYZE action naming.

## 1. Product principle

GAYZE should distinguish between **discovery**, **connection**, and a **verified Past Meet**. A QR scan establishes that two authenticated users intentionally confirmed a meet. It does **not** automatically grant access to current Intent.

The privacy rule is two-way for the relationship but not automatically two-way for visibility:

> A QR-confirmed Past Meet creates the relationship. Each person separately controls whether their current Intent is visible to Past Meets.

## 2. Past Meet lifecycle

### 2.1 QR flow

1. User A opens **Meet → My QR**.
2. User B scans the QR while authenticated.
3. The server validates a short-lived, rotating token.
4. The server creates or confirms a Past Meet relationship between A and B.
5. Both users receive a confirmation notification.
6. The relationship becomes eligible for the Past Meet privacy audience.

### 2.2 QR security

QR codes must not contain a permanent user identifier as the trust mechanism. Use a short-lived, signed, server-verifiable token.

Requirements:
- Authenticated scanner.
- Short expiry.
- Single-use or idempotent consumption.
- Server-side validation.
- No sensitive profile data in the QR payload.
- Repeated scans between the same pair must not manufacture repeated reliability points.
- Ability to revoke/remove a Past Meet relationship.

## 3. Intent visibility choice system

Settings → Privacy & Visibility → Intent.

### Audience choice

- **Everyone**
- **Past Meets**
- **Connections**
- **Nobody**

### Dedicated Past Meet toggle

**Let people I've met see my current Intent** — ON/OFF.

The effective server-side rule is the intersection of the user's configured audience and the viewer's relationship to that user. The client must never receive a current Intent that the viewer is not authorised to see.

### Intent display

If authorised:
- Private / Spicy → purple treatment.
- Social → amber/gold treatment.
- No active Intent / paused / expired → no live Intent signal.

## 4. Reliability model

A QR confirmation is evidence of a real-world interaction, not a score by itself. Reliability should measure behavioural consistency over time.

### Positive signals

- QR-confirmed Past Meet: strong positive baseline event.
- Multiple unique Past Meets over time: positive.
- Proposal/meet accepted and subsequently QR-confirmed: stronger positive signal.
- Independent post-meet confirmation by both participants: strong positive signal.
- Consistent Intent-to-meet behaviour: positive.

### Negative signals

- Confirmed proposal followed by a no-show: negative.
- Repeated cancellations after confirmation: negative.
- Repeated reports of misleading Intent: negative, subject to safeguards/review.

### Do not score directly

- Raw number of QR scans.
- Popularity/follower count.
- Repeated scans of the same person in a short period.

### Anti-gaming

- One meaningful reliability event per pair per defined time window.
- Unique counterpart diversity is weighted.
- Reciprocal scanning patterns are discounted when suspicious.
- New accounts have limited scoring weight.
- Reliability has time decay so recent behaviour matters more.
- A QR scan alone does not prove the person completed the planned meet.

## 5. Intent Accuracy

GAYZE may expose a separate high-level **Intent Accuracy** signal rather than hiding it inside the headline reliability number.

Example:

> Reliability 94%  
> Intent accuracy 91%  
> 12 verified meets  
> 11 successful

Intent accuracy is derived from declared Intent → proposal/commitment → QR-confirmed meet → optional independent confirmation. It must not expose private reporting details.

## 6. Proposal Meeting integration

The existing proposal-meeting feature should become the bridge between intention and verified meeting.

Lifecycle:

**Intent → Proposal → Accept → Meet → QR confirmation → Post-meet confirmation → Reliability update**

Required notifications:

### Proposal created

Notify the recipient that a meet proposal has been received.

### Proposal accepted

Notify the proposer that the meet has been accepted and show the agreed details.

### Upcoming meet

Send an appropriately timed reminder before the proposed meeting.

### Meet window

Surface the QR/check-in action when the agreed meet window is active.

### QR confirmation

Notify both participants that the Past Meet relationship has been confirmed.

### Post-meet

After the meet window, send a neutral notification asking each participant:

> **Did this meet happen as expected?**

Choices:
- Yes
- No
- Don't say

A single "No" must not automatically punish the other user. It should create an anomaly/review signal and feed the reliability system according to defined safeguards.

## 7. GAYZE action naming

Replace the generic **Interested** action with:

> **Gayze**

The action should be treated as the GAYZE equivalent of a like/interest signal, while keeping it distinct from an Intent state.

Recommended states:
- **Gayze** — available action.
- **Gayzed** — the current user has sent the signal.
- **Gayze back** — reciprocal signal where appropriate.

The action must not imply consent to meet, reveal current Intent, or create a Past Meet.

## 8. Data/privacy boundary

The client must not determine Past Meet eligibility or current Intent visibility itself. The server must enforce:

`viewer → relationship → owner's visibility policy → authorised Intent response`

Reliability calculations should run from trusted server-side events. Client-side UI events are not sufficient evidence for scoring.

## 9. Suggested data model

Conceptual entities:

- `past_meets`
  - `id`
  - `user_a`
  - `user_b`
  - `confirmed_at`
  - `source` = `qr`
  - `status`
  - `revoked_at`

- `qr_meet_tokens`
  - `id`
  - `issuer_user_id`
  - `token_hash`
  - `expires_at`
  - `consumed_at`

- `intent_visibility_preferences`
  - `user_id`
  - `audience`
  - `past_meets_enabled`

- `meet_events`
  - `proposal_id`
  - `event_type`
  - `occurred_at`
  - `actor_user_id`

- `meet_feedback`
  - `meet_id`
  - `user_id`
  - `outcome`
  - `submitted_at`

- `reliability_events`
  - `user_id`
  - `event_type`
  - `counterparty_user_id`
  - `weight`
  - `occurred_at`
  - `source_event_id`

- `reliability_scores`
  - `user_id`
  - `score`
  - `intent_accuracy`
  - `verified_meets_count`
  - `successful_meets_count`
  - `calculated_at`

Names should be reconciled with the existing Supabase schema before migration; this document is the behavioural contract, not permission to duplicate existing tables.

## 10. UI placement

### Profile

Show high-level reliability only when enough evidence exists. Example:

**Reliable** · **94%** · **12 verified meets**

Do not expose private feedback details.

### Past Meets

A dedicated list can show:
- Person.
- Last verified meet date.
- Whether their current Intent is visible to the viewer.
- Optional reliability badge.

### Discovery

Current Intent remains visible only when server-authorised. Purple/amber ambient card styling follows the Intent state.

## 11. Acceptance criteria

- A QR scan cannot by itself reveal current Intent.
- Past Meet visibility is server-enforced.
- Expired/revoked QR tokens cannot create relationships.
- Duplicate QR scans cannot inflate reliability.
- Proposal → meet → QR → feedback events are auditable.
- Notifications exist for proposal, acceptance, reminder, QR confirmation and post-meet feedback.
- Reliability cannot be manufactured by repeated reciprocal activity.
- Current Intent never leaks through an unauthorised discovery/profile response.
- **Interested** is replaced by **Gayze** throughout the relevant user-facing UI.
