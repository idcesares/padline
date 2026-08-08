# ADR-0016: One module owns every access credential, write side included

**Status:** accepted (2026-08-08)

Supersedes the `roToken` ownership consequence of ADR-0015 and extends what
that decision assigned to `RoomSecurity`: from validating credentials to owning
their whole lifecycle. The rest of ADR-0015 — the two-module split, the admin
and block precedence ordering, and the two comparison primitives — stands.

## Context

ADR-0015 described `RoomSecurity` as owning PIN hashing, sessions, backoff, and
the admin secret. That was true of the *read and validate* side only. Every
access-credential storage key had a second owner on the *write and invalidate*
side, and one had a third:

- `pin` — `RoomCapabilities` put and deleted it; `RoomSecurity` read it in
  `canEdit`.
- `sessions` — `RoomCapabilities` deleted it on PIN set and PIN removal;
  `RoomSecurity` put and read it.
- `pinFails` — `RoomCapabilities` deleted it on a successful verify;
  `RoomSecurity` put and read it.
- `roToken` — `RoomCapabilities` minted and rotated it, `worker/index.ts` read
  it during WebSocket admission, and `RoomSecurity` deleted it in
  `clearSecrets()`.

The split went deeper than storage. The PIN comparison itself — `hashPin`
against the stored salt, then `safeEqual` against the stored hash — ran inside
the `verify-pin` capability handler, and the `PinRecord` holding both salt and
hash was fetched in `handle()` and threaded through a context object into every
capability path. `safeEqual` was exported to both other modules, so
`worker/index.ts` carried its own copy of the read-only token comparison rule.

This is the same shape ADR-0014 removed for persisted pad state, on the
security-critical surface: a rule whose enforcement and whose invalidation
live in different files cannot be kept agreeing by the type system, only by
whoever is reading both at the time.

## Decision

`worker/room-security.ts` owns access-credential state end to end: the `pin`,
`sessions`, `pinFails`, and `roToken` keys, PBKDF2 hashing, both comparison
primitives, the 4–64 character PIN rule and its `trim()`, the backoff schedule,
the session TTL and cap, and read-only token minting and rotation. All of it is
private; callers ask for outcomes (`isPinProtected`, `canEdit`,
`verifyReadOnlyToken`, `verifyPin`, `setPin`, `removePin`, `readOnlyToken`,
`rotateReadOnlyToken`, `clearSecrets`, `isAdmin`).

**Read-only link tokens are a credential, not a capability detail.** This is
the part ADR-0015 got wrong and flagged as a rough edge. The distinguishing
test is whether a caller *presents* the value and the room must *validate* it:
`roToken` is compared against a caller-supplied string on the WebSocket
admission path, so leaving minting elsewhere duplicated a rule across three
files. `blocked` fails that test — it is state the room reads, presence is the
entire check, and there is no rule that can drift — so it stays with
`RoomCapabilities` and `PadRoom.onConnect` keeps reading it directly.

**Transitions return outcomes, not booleans.** `verifyPin` has four failure
reasons mapping to three status codes, one of which carries a `retry-after`
header; a boolean would force the caller to re-query state to decide which.
`RoomCapabilities` keeps the reason-to-status mapping, so renaming a domain
reason cannot silently change the wire API.

**The PIN candidate is supplied lazily**, as a callback rather than a value.
The guards ahead of it must run first: a pad with no PIN, and one inside its
backoff window, are both answered without the request body being read. Passing
the parsed candidate would have moved the malformed-body check ahead of the
throttle, turning a 429 into a 400 for a throttled caller sending garbage.

`RoomCapabilities` keeps op and method matching, request field-shape coercion,
the `canEdit` authorization call, response mapping, and the `blocked` key.
`PadRoom` keeps admission: it decides which capability a socket is claiming —
an empty `?ro=` claims none and falls through to the edit gate — and asks
`RoomSecurity` whether the credential is good. `RoomSecurity` still has no
outbound calls, so WebSocket admission never reaches its authorization decision
through the HTTP capability module.

Two redundant guards were removed as provably equivalent, not as a behavior
change: `pin && !(await canEdit(token))` is identical to `!(await
canEdit(token))`, because `canEdit` already returns `true` when no PIN exists.
Both reads happen inside one Durable Object request with no interleaving.

## Consequences

- `hashPin`, `PinRecord`, `safeEqual`, `pinRetryDelay`, `recordPinFailure`, and
  `createSession` are no longer exported. Nothing about credentials leaves the
  module except the class, which is the check that the boundary is in the right
  place — `safeEqual` previously escaped to both other modules.
- `RoomCapabilities` no longer touches a credential storage key, and no longer
  carries a salt and hash through its request context.
- Changing PIN, session, backoff, or read-only-link behavior is a change to one
  file, and cannot apply to HTTP while missing WebSocket admission.
- Verification follows ADR-0011: ten characterization tests were added to the
  Workers-runtime suite *before* the refactor and passed against the old code
  unchanged. Most of this surface was previously covered only by
  `scripts/api-smoke.mjs`, which needs a running server — the runtime suite had
  no WebSocket admission test for PIN or read-only tokens at all, and session
  invalidation, session TTL, and "rotation leaves live sockets open" were
  untested everywhere.
- `runInDurableObject` is used only to move a stored clock — the backoff window
  and a session's grant time — following the existing `lastSnapshotAt`
  precedent. Nothing is seeded through it.
- The 200-session cap remains uncharacterized. Reaching it through the public
  interface costs 201 real 100,000-iteration PBKDF2 grants, and seeding the
  session map would bypass the minting path that enforces the cap. Overshooting
  evicts the oldest session, so the untested behavior is an availability bound,
  not a confidentiality boundary.

## Rejected

- **A storage-only move**, leaving the length rule and the hash comparison in
  the capability handler. It removes the raw key writes but leaves PIN
  validation split across two modules — the shallow extraction that makes the
  diff look like progress without moving the boundary.
- **Moving `blocked` to `RoomSecurity` as well**, so admission reads no storage
  key at all. Coherent, but takedown is not a presented credential, ADR-0014
  placed the key deliberately, and splitting it from the precedence ordering in
  `handle()` would spread ADR-0015's load-bearing rule across two modules.
- **Returning HTTP response shapes from `RoomSecurity`**, so capabilities never
  asks `isPinProtected()`. It pulls response formatting into the leaf module
  that WebSocket admission depends on, which is what ADR-0015 rejected in the
  other direction.
- **Superseding ADR-0015 wholesale.** Its two-module reasoning and its
  `safeEqual`/`digestEqual` rationale are unaffected by this change and are
  still the reason the code is shaped this way.
- **A storage adapter or mock seam, or a clock seam for backoff and TTL.**
  Rejected for the same reason as in ADR-0011 and ADR-0014: they would exist
  only for tests, and the real runtime can be driven directly.
- **Characterizing the session cap with 201 live grants.** Roughly 30 seconds
  added to every `npm test` run to pin an availability bound. Documented as a
  gap instead, in the spec and above.

## Related

ADR-0005 (PIN gates everything; read-only links are server-enforced tokens),
ADR-0009 (brute-force backoff, session TTL, read-only token rotation),
ADR-0010 (purge wipes every secret; admin concealment), ADR-0011
(Cloudflare-native verification), ADR-0014 (the same deepening applied to
persisted pad state, and `clearSecrets()`), and ADR-0015, which this amends.
