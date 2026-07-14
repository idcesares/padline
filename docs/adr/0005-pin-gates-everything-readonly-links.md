# ADR-0005: PIN gates view AND edit; read-only links are server-enforced tokens

**Status:** accepted (2026-07-14)

## Context

No accounts in v1, but real use requires some protection and safe sharing. A PIN that gates only edits leaves secret notes readable and creates two states to explain.

## Decision

- **PIN (optional, per pad):** set from the share dialog; gates everything — the room sends no document bytes before PIN verification. Hash stored in the room; successful entry grants a signed token/cookie so users aren't re-prompted.
- **Read-only link:** every pad exposes a secondary URL containing a random token; connections via it are view-only, enforced by the room refusing Yjs writes on that connection — not a UI-side lock.

## Consequences

- One gate, one mental model; real security, not theater.
- Slightly more server logic (auth before document send) than a UI lock. Accepted.

## Rejected

- PIN gating edits only (two states; secrets still leak).
- No read-only links (it's where "I'd use this for real things" begins; ~a day of work).
