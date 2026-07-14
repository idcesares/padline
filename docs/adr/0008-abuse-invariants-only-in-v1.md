# ADR-0008: V1 ships abuse invariants only; machinery deferred

**Status:** accepted (2026-07-14)

## Context

The proposal's twelve-item security list is sized for a public service. Text-only pads with size caps have a small blast radius; heavy machinery earns its keep only when uploads and traffic exist.

## Decision

V1 enforces only the cheap-to-enforce, catastrophic-to-miss limits, inside the room where possible:

- strict slug validation (length, charset, reserved words: `api`, `assets`, …);
- document size cap (~2MB Yjs state — updates past it are rejected);
- connection caps (~50 sockets per pad; per-IP cap);
- WebSocket message size limit;
- per-IP rate limit on pad creation via Cloudflare's built-in rate-limiting rules (zero code).

Deferred to phase 2 (with images, ADR-0007): Turnstile, abuse reporting, admin deletion tooling, quota dashboards.

## Related

Expiration is also deferred entirely — storage math (text pads ≈ KB; free tier = 5GB ≈ a million pads) shows it solves a problem we won't have for years. It returns later as a *feature* ("self-destruct pads"), not hygiene plumbing.
