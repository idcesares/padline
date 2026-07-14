# ADR-0004: Hybrid pad creation — URL-first auto-create, random slugs by default

**Status:** accepted (2026-07-14)

## Context

Pure Dontpad semantics (any path is a pad) create graffiti walls at guessable paths (`/notes`, `/test`), turn typos into confusing blank pads, and invite slug enumeration. Explicit-creation-only kills the URL-first magic.

## Decision

Visiting any valid `/:slug` still auto-creates an editable pad, but the landing page's primary action generates a random readable slug (`/mellow-otter-42`); a secondary input opens a specific path. A pad's room is **not persisted until the first keystroke**, so typos and crawler hits mint nothing.

## Consequences

- People who choose memorable URLs keep the Dontpad magic; the default path yields unguessable URLs.
- Guessable-slug graffiti remains possible by design; mitigated by PIN protection (ADR-0005) and abuse invariants (ADR-0008).
