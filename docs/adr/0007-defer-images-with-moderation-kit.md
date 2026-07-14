# ADR-0007: Defer hosted images/attachments to phase 2, bundled with the moderation kit

**Status:** accepted (2026-07-14)

## Context

BlockNote invites image paste on day one, but anonymous no-account image hosting is a serious abuse magnet — effectively operating a free image host with the owner's name on the Cloudflare account.

## Decision

V1 disables BlockNote's image/file blocks. Phase 2 ships hosted images (R2) **together with** the abuse kit they require: Turnstile challenge before upload, per-pad storage quotas, and a report/delete flow. These are one bundle; none ships without the others.

## Rejected

- Images in v1 with basic size limits (abuse exposure with zero moderation tooling).
- External-URL-only images (pasted screenshots — the actual use case — don't work).
