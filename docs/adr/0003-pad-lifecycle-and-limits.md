# ADR-0003: Pad lifecycle, slugs and limits

**Status:** accepted (2026-10-31)

## Context

With a public notepad (ADR-0001) the addressing rules and limits are the
product. They also protect the Cloudflare free tier.

## Decision

### Slugs

- Flat only: `/trip-food`. No nested paths and no subpage listing.
- Lowercase letters, digits and hyphens. Case-insensitive; accents are folded
  (`Ação` becomes `acao`); spaces and underscores become hyphens; repeated and
  edge hyphens are trimmed. Length 1 to 64.
- Reserved words live in one constant: `api`, `admin`, `report`, `about`,
  `assets`, `static`, and others added as needed.
- The landing page shows how the typed text will be normalized ("Opens as ...")
  before the visitor commits.

### Lifecycle

- Every valid slug is an editable pad. There is no 404.
- A room is not persisted, and the pad is not indexed, until the first
  keystroke. Typos and crawlers mint nothing.
- Landing page: one input plus a "random address" button
  (`mellow-otter-42` style).
- Pads are kept forever in v1. Idle cleanup is a later ADR if storage nears the
  free limit.
- Recently opened pads are remembered on the device only (localStorage).

### Limits

- About 1 MB of document state per pad. Past it the room stops saving and tells
  everyone on the pad it is full (a `pad-full` message, shown as a banner). The
  visitor can delete text or download a copy; once the text is back under the
  limit the room resumes and tells everyone (`pad-ok`). At twice the limit it
  refuses edits outright. This is a soft cap on purpose: a hard refusal would
  also block the deletions that fix the problem.
- About 50 live connections per pad, with a message size limit.
- Rate limiting is a Cloudflare rule, not application code.
- No images or file uploads.
- Download as `.md` or `.txt`.

## Consequences

- The slug validator and reserved list are shared by the client and the Worker.
- The 1 MB, 50-connection and message limits are constants in one module
  (`shared/limits.ts`) and are listed in `docs/reference/configuration.md`.
- The room reads only the `doc`, `docOverCap` and `blocked` storage keys;
  anything else in a room's storage is ignored.
- Cloudflare free-tier figures (requests per day, Durable Object and D1 limits)
  must be verified on the official pages before launch.

## Rejected

- Nested paths and listings: they invite directory-style abuse and need a
  different storage model.
- A 404 for unknown slugs: it breaks "open any address and type".
- Expiry in v1: it reads as a privacy feature, which this product does not
  promise.
