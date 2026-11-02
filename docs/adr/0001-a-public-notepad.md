# ADR-0001: A public notepad

**Status:** accepted (2026-10-31)

## Context

Padline is a modern Dontpad: open an address, type, and everyone on that
address sees it live. The product has to stay simple and work out of the box.
Anything that adds weight to that promise (access control, heavy editors,
compliance machinery) needs a reason strong enough to justify a new ADR.

## Decision

Padline is a **public notepad**. Pads are public by design: anyone who knows
the address can read and edit, and the operator can see every pad. The site
says so in one line. There is no privacy promise and no access control.

- **Promise (v1):** open any address, type, and it is saved and live for
  everyone on that address. Nothing else ships in v1.
- **Editor:** CodeMirror 6, plain text with Markdown highlighting, bound to Yjs
  with y-codemirror.next. A Markdown preview toggle (split on desktop, tab on
  phone) is planned.
- **Sync and storage:** Yjs, y-indexeddb as the local cache, y-partyserver on a
  SQLite-backed Durable Object per pad, WebSocket hibernation. The room owns the
  persisted state.
- **Host:** Cloudflare only. One Worker serves the WebSocket, the small HTTP
  surface and the static assets. One `wrangler deploy`.
- **Frontend:** Vite and plain TypeScript with hand-written CSS. No framework,
  no router, no component library. The design spec is
  `docs/design/mockup.html`.
- **Design bar:** the page is the editor; chrome fades while typing; every state
  (connecting, saved, offline, reconnecting, pad full, invalid or reserved
  address, busy, removed) is designed; light and dark follow the system; mobile
  first; keyboard first; WCAG AA; copy in PT-BR and EN (widened to six
  languages by [ADR-0005](0005-interface-languages.md)).
- **Not in v1:** version history, comments, accounts, images and uploads,
  command palette.

## Consequences

- The domain language stays small: pad, slug, room, identity, presence, report,
  block (see `CONTEXT.md`).
- Anything that adds a privacy promise, an access gate or a heavier editor needs
  a new ADR that supersedes this one.

## Rejected

- Portable hosting (Node, Postgres, self-hosted): it doubles the surface for no
  v1 benefit. Cloudflare's free tier fits the promise.
- A WYSIWYG editor: it pulls in history, export formats and larger size caps,
  and moves the product away from a plain, fast text area.
