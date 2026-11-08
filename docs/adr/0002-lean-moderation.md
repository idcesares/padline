# ADR-0002: Lean moderation for a public notepad

**Status:** accepted (2026-10-31). Built: the room's block and `?op=status`,
the D1 pad index, the admin page and API, and the public report page.

## Context

A public, indexable notepad attracts spam and worse. Pads are public and the
operator may see every pad, so heavy process has no job here. What it needs is
the floor: a way to report, a fast way to act, and a short record.

## Decision

- **Pad index:** a small table (slug, size, created, last edit, edit count).
  Written on the first non-empty save and then at most once a minute per room
  (an alarm flushes the last change). It lives in D1: the free tier allows 5M
  reads and 100k writes a day and 5 GB, far above this load. Past a cap, queries
  fail until 00:00 UTC; the pad itself keeps working because the room never
  depends on the index.
- **Admin page** behind Cloudflare Access: lists recent, largest, most active,
  reported and blocked pads, with a count on the active, reported and blocked
  tabs (numbers only, no new table); shows an excerpt; lets the operator open,
  delete the content of, or block a pad.
- **Three tables:** `pads`, `reports`, `actions`. None holds pad content or
  evidence copies. `actions` rows are never updated or deleted.
- **Public report page** (`/report`): a category from a short fixed list, a
  slug, an optional contact. No IP address is stored. The response never reveals
  whether a pad exists.
- **One block action:** the room is the enforcement authority. A blocked slug
  shows a removed notice with the category and date, never the operator's
  reason.
- **Grave content** (for example child abuse material): purge and refer. Whether
  anything is retained is a question for a lawyer, not for v1 code.
- **Reserved slugs** (`api`, `admin`, `report`, ...) live in one constant.

## Hard cap

No cases, evidence retention, exports, bulk actions, moderation profile, hash
chain or categories beyond the short fixed list. Anything more needs a new ADR.

## Consequences

- Legal exposure for `padline.page` rests on a working report channel, fast
  action and a short record. It is not an assurance of compliance; take legal
  advice before relying on it.
- A room's `admin-*` operations are never reachable from the public route; the
  Worker refuses them on `/parties`.
- The admin API calls the room first, then writes the D1 rows in one batch. If
  D1 fails after the room acted, the API answers 503 and the action stays in
  effect; the page reloads to show the truth.
- The Worker verifies the Access JWT itself (RS256, JWKS cached for an hour,
  issuer, audience, expiry) and fails closed with 403 when `ACCESS_TEAM_DOMAIN`
  or `ACCESS_AUD` is empty. A localhost-only bypass exists for development
  (`ADMIN_DEV_BYPASS=1`) and is ignored on any other hostname.
- Reports are capped at 50 open per slug; the note is at most 280 characters and
  the contact at most 120. The operator's reason is not stored, only the
  category. There is no unblock action; a mistaken block is fixed in the
  database by hand.
- "Edits" in the admin list is a plain count of index writes, not the "edits in
  24 h" figure the mockup shows. "Most active" is last edit within 24 h ordered
  by that count.
- **Known limit:** emptying a pad cannot erase a copy that a visitor holds
  offline in their browser and later re-syncs. Block is the hard remedy: it
  deletes the document, closes sockets with 4404, and the client clears its
  local copy when it sees the removed notice. The report form tells people not
  to paste pad content.

## Rejected

- Case management with evidence capture and a tamper-evident log: its weight
  would outgrow the product it protects.
- No moderation at all: a report channel and a block action are the floor.
