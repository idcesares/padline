# ADR-0015: Room capability handling and shared access security are separate modules

**Status:** accepted (2026-08-05) — recorded retroactively 2026-08-07

This decision shipped in PR #10 without an ADR. It is reconstructed here from
the merged code and that PR's description so the record is complete; the
reasoning below is the reasoning visible in the result, not a later change of
direction. Nothing in the code changed to write it.

## Context

`worker/index.ts` had reached 700 lines, most of it a single `PadRoom.onRequest`
dispatcher mixing four unrelated jobs: deciding whether a caller is authorized,
applying storage transitions, enforcing takedown precedence, and mapping
outcomes to HTTP responses. Reading any one pad capability meant reading all of
them. The split brought that file to 335 lines.

The room's HTTP surface is also security-critical in a way that is easy to get
subtly wrong: ADR-0005 requires the PIN to gate everything server-side,
ADR-0009 adds brute-force backoff and token lifetimes, and ADR-0010 requires
the admin surface to be *concealed* rather than merely refused. Those rules
were interleaved with response formatting.

## Decision

Two modules, split along what consumes them.

**`worker/room-capabilities.ts` — `RoomCapabilities`.** One entry point,
`handle(request)`, so the external Room HTTP seam is unchanged and
`PadRoom.onRequest` becomes a single delegation. Inside, capability paths are
separate private handlers chained by first-match, and the order is load-bearing:

1. **admin concealment outranks everything.** An `admin-*` op with a missing or
   wrong secret answers exactly like an unknown op (404), before any pad state
   is read (ADR-0010).
2. **a block outranks ordinary capabilities.** Blocked pads answer 410, except
   public `info`, which reports `removed: true` so the client can render the
   takedown notice without opening a socket.
3. ordinary access, read-only link, and snapshot capabilities.

**`worker/room-security.ts` — `RoomSecurity`.** PIN hashing (PBKDF2, 100k
iterations, per-pad salt), session minting with a TTL and a cap, failure
backoff, and admin-secret comparison.

**Why two modules rather than one.** `canEdit` is consumed by both transports:
`PadRoom.onConnect` calls it to admit a WebSocket, and four HTTP capability
paths call it to authorize an op. Folding access security into
`RoomCapabilities` would make WebSocket admission depend on the HTTP module for
its authorization decision — the room's most security-critical path taking a
detour through an unrelated concern. `RoomSecurity` is therefore a leaf with no
outbound calls, shared by both.

**Two comparison primitives, deliberately.** `safeEqual` short-circuits on
length, which is correct and cheap for values whose length is already public —
base64 hashes and UUIDs. `digestEqual` hashes both operands to a fixed 44
characters first, and is used for `ADMIN_SECRET`, whose length is *not* public:
`safeEqual` applied directly to it would let a caller probe its length.

`PadRoom` keeps WebSocket connection gating — slug validity, block refusal,
connection and per-IP caps, read-only vs edit capability, message size. That is
admission, not an HTTP capability.

## Consequences

- A pad capability can be read, changed, or audited without reading the others.
- Authorization rules have one home, so a change to PIN or session behavior
  cannot apply to HTTP but silently miss WebSocket admission.
- The concealment and block precedence rules are expressed as ordering in one
  function instead of being implied by scattered early returns.
- Verification stayed at the Room's external interface per ADR-0011:
  characterization tests cover admin concealment, block precedence, purge, the
  PIN lifecycle, and snapshot outcomes through Room HTTP, with no new seam.
- `roToken` minting stayed with the read-only-link capability rather than moving
  to `RoomSecurity`. It is a capability secret held outside the module that owns
  the others — a known rough edge, revisited in ADR-0014.

## Rejected

- **One module for the whole HTTP surface, security included.** Makes WebSocket
  admission depend on the HTTP capability module; see above.
- **Free functions instead of classes.** Both modules hold the same collaborators
  (`storage`, and for security the `env` secret) across every call. Threading
  those through free functions would move the parameters, not hide them.
- **Splitting per capability (a module each for PIN, read-only links,
  snapshots).** They share the authorization preamble and the block/admin
  precedence, so each module would re-derive the same context and the ordering
  rule would lose its single home.

## Related

ADR-0003 (Room as the pad's authority), ADR-0005 (PIN gates everything;
read-only links), ADR-0009 (brute-force backoff and token lifetimes), ADR-0010
(admin concealment, block precedence, purge), ADR-0011 (Cloudflare-native
verification), and ADR-0014, which later moved persisted pad state out of both
modules and added `RoomSecurity.clearSecrets()`.
