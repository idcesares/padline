# ADR-0014: One module owns persisted pad state, including the live document

**Status:** accepted (2026-08-07)

## Context

A pad's durability rules were split across three files. `worker/index.ts` held
the snapshot schema, document restore, the size cap, freeze persistence, and
snapshot cadence and retention. `worker/room-capabilities.ts` held snapshot
listing, restore, freeze recovery, operator inspection, purge, and the live
document reset. A mutable `RoomRuntimeState` object was passed between them so
both could read and write the freeze marker.

That split meant the storage keys `doc`, `docOverCap`, and `lastSnapshotAt`, the
`snapshots` table, and the `"document"` fragment name each had several owners —
the fragment name alone was written out at three call sites. Every one of these
operations has to keep Durable Object storage and the warm Yjs document
agreeing with each other, and nothing in the code said so.

## Decision

`worker/room-persistence.ts` owns persisted pad state: the `snapshots` table and
its schema, the `doc` / `docOverCap` / `lastSnapshotAt` keys, the document size
cap, the snapshot cadence and retention constants, and the `"document"` fragment
name with its Yjs root-type mapping. They are private to it; callers ask for
outcomes (`load`, `save`, `isFrozen`, `listSnapshots`, `restoreSnapshot`,
`inspect`, `purge`).

**It also owns both live-document transitions** — the `unstable_replaceDocument`
call behind a snapshot restore, and the fragment reset behind a purge. This is
the non-obvious part. The live document belongs to `PadRoom`, so the tempting
boundary is for persistence to touch storage only and let the caller update the
warm document. That boundary is wrong here: a restore that cleared the freeze
marker without replacing the document, or a purge that wiped storage without
resetting the fragment, would leave the Room serving content the pad no longer
has. The two halves are one transition and belong to one owner. `PadRoom` keeps
the y-partyserver dependency, reduced to a one-line adapter.

`RoomRuntimeState` is deleted. The freeze marker is private state read through
`isFrozen()`.

Access state stays with `RoomSecurity`, reached through a new `clearSecrets()`,
so a purge composes two outcome-oriented calls instead of one seven-key delete
spanning both concerns. `blocked` stays with `RoomCapabilities`: takedown is an
access decision, not a durability one.

No storage transaction is introduced. This was a behavior-preserving refactor;
purge and save keep their existing non-transactional sequencing, which Durable
Object write coalescing and output gating already make safe within a request.

## Consequences

- Changing how a pad is stored, snapshotted, capped, or wiped is now a change to
  one module rather than coordinated edits across three.
- `RoomCapabilities` no longer imports Yjs, holds no reference to the live
  document, and executes no SQL against the snapshot table.
- The freeze marker cannot drift between two owners, because there is only one.
- Verification follows ADR-0011: the invariants are characterized in the real
  Workers runtime through the Room's HTTP interface, WebSocket admission, and
  Durable Object eviction. `runInDurableObject` establishes only what the public
  interface cannot reach — a document past the 256KB message cap, snapshot
  cadence past the 60s real-time interval, and a synthetic connection for the
  read-only decision — while every assertion runs through the external
  interface, so the tests survived the refactor unchanged.
- Seven characterization tests now pin behavior that was previously implicit,
  including that an over-cap save preserves the last accepted document and that
  a warm Room cannot re-persist purged content.

## Rejected

- **A storage adapter or mock seam.** There is one production storage
  implementation. A second one would exist only for tests, and ADR-0011 already
  rejected the equivalent move for room policy helpers.
- **An injectable clock for snapshot cadence.** Same objection: it is a test-only
  seam. Moving the stored cadence marker in the real runtime characterizes the
  real code path instead.
- **Splitting persisted state from live-document recovery.** See above: it makes
  the storage/document coordination the caller's problem, which is the friction
  this decision removes.
- **Extending the module to own PIN, sessions, and read-only tokens** because a
  purge wipes them too. Those are `RoomSecurity`'s, and a second owner for PIN
  state would recreate the exact problem `RoomRuntimeState` caused.
- **Wrapping purge in a storage transaction as part of this change.** Possibly
  worth doing, but it is a behavior change and needs its own evidence.

## Related

ADR-0003 (Room collaboration), ADR-0004 (pads unpersisted until the first
keystroke), ADR-0006 (snapshot cadence, retention, restore-as-edit), ADR-0008
(document size cap), ADR-0010 (purge, block, and operator inspection), and
ADR-0011 (Cloudflare-native verification and the durable over-cap marker).
