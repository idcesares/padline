# ADR-0009: Brute-force backoff, token lifetime, and header hardening

**Status:** accepted (2026-07-16)

## Context

A security review of v1 found the authorization core sound (server-side, fail-closed) but unhardened around retries and lifetime: unlimited PIN attempts, immortal session and read-only tokens, a random-slug space small enough to enumerate (~52k), and no defense-in-depth headers.

## Decision

All enforcement stays inside the room (per ADR-0008's philosophy), no external services:

- **PIN backoff, per room.** 5 free attempts, then exponential delay (1s doubling, capped at 60s) enforced with a stored failure counter; throttled attempts return 429 + `retry-after`. Counter clears on success. The Cloudflare per-IP rate-limit rule remains the outer layer. A 4-digit PIN now costs ~a week of wall-clock per pad instead of minutes.
- **Sessions expire.** Edit-session tokens are valid for 30 days from grant (checked lazily; expired entries deleted on sight).
- **Read-only tokens rotate.** `POST op=ro-token` (edit auth required) mints a replacement; old links stop working on next connect. Exposed in the share dialog as "Reset link".
- **Per-IP connection cap** (8 sockets/pad/IP) via `CF-Connecting-IP`, implementing what ADR-0008 promised. Skipped when the header is absent (local dev).
- **Slug entropy**: 48 adjectives × 48 animals × 4-digit number ≈ 20.7M combinations. Hard to enumerate behind rate limiting, but still not a secret — PIN protection remains the confidentiality tool.
- **Headers**: CSP (self-only + inline styles, no framing), `nosniff`, `no-referrer` on all HTML/asset responses. CSP is skipped on localhost (Vite dev injects inline scripts).
- **Robustness**: malformed JSON bodies return 400; the message size cap counts UTF-8 bytes, not UTF-16 units.

## Accepted tradeoffs (explicitly not fixed)

- **Anyone can set a PIN on an unprotected pad**, locking out current users. Inherent to the no-account model — the first person to claim a pad wins. Content survives in snapshots.
- **Tokens travel in URL query params** (HTTP ops and WS connect). Acceptable at current scale; revisit (header / WS subprotocol) if logs ever leave Cloudflare.

## Related

ADR-0005 (PIN gates everything), ADR-0008 (abuse invariants).
