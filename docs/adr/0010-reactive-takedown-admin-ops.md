# ADR-0010: Reactive takedown via secret-gated admin ops, no dashboard

**Status:** accepted (2026-07-16)

## Context

The published Terms and Content Policy promise enforcement ("pads may be
cleared or made inaccessible") and the Privacy Policy invites removal
requests — but the code could not deliver any of it:

- Clearing a pad as an editor leaves up to 100 snapshots that anyone in the
  pad can restore (ADR-0006 restore-as-edit is right for users, but it makes
  editing useless as an enforcement tool).
- A PIN gates *view* server-side (ADR-0005), so the operator couldn't even
  inspect a reported pad, let alone clear it.
- There was no "inaccessible" state: any wiped slug immediately mints a
  fresh editable pad (ADR-0004) that the abuser refills.

Moderation is explicitly reactive (reports arrive by email with a pad URL);
report volume is near zero; there is exactly one operator.

## Decision

Three slug-addressed operations on the room's HTTP surface
(`/parties/pad-room/:slug?op=admin-*`), driven by `scripts/admin.mjs`:

- **admin-info** — metadata plus a content preview from the *persisted* doc.
  Works through a PIN: the PIN gates visitors, not enforcement.
- **admin-purge** — wipes doc, all snapshots, PIN, sessions, and read-only
  token; closes live connections; resets the in-memory doc so a warm room
  can't resurrect content. Also serves privacy-policy removal requests.
- **admin-block / admin-unblock** — a `blocked` record in the room's own
  storage. Blocked pads refuse sockets (close code 4404) and non-admin ops
  (410), except `op=info`, which reports `removed: true` so the client
  renders a takedown notice. The block record survives a purge — purge+block
  is the takedown combo, purge alone is a removal request.

Auth is a single `ADMIN_SECRET` bearer token (Wrangler secret), compared in
constant time inside the room. Fail closed and reveal nothing: a missing or
wrong secret — or a deployment with no secret set — answers exactly like an
unknown op (404).

## Rejected

- **Admin dashboard / pad registry.** Durable Objects aren't enumerable, so
  a dashboard implies building a central index of every pad — a new, highly
  sensitive dataset that contradicts the privacy posture ("we know as little
  as possible"). Reports arrive with a URL; slug-addressed ops are enough.
- **In-app report button.** A report endpoint is itself an abuse vector and
  needs bot protection; it stays bundled with the phase-2 moderation kit
  (ADR-0007). Email reporting is adequate at current volume. (No conflict
  with ADR-0007: that defers the *reporting/upload* flow, not the operator's
  ability to enforce the policy that already binds the service.)
- **Blocklist outside the room (KV/Worker-level).** A second storage system
  and a consistency problem, for no benefit: the room is addressed by slug,
  so its own storage is exactly as authoritative and survives re-creation.
- **`unstable_replaceDocument` with an empty snapshot for purge.** Its
  UndoManager requires at least one root type in the target snapshot and
  throws on an empty doc; deleting the fragment content in a transaction is
  equivalent and lets Yjs GC drop the bytes.
