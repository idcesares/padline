# Padline: Domain Context

Padline is a public, no-account, real-time notepad. Opening an address *is* opening (or creating) a pad: type, and everyone on that address sees it live. Pads are public by design (ADR-0001).

## Ubiquitous language

- **Pad**: one shared document, identified by its slug. The unit of everything: sync, storage, size limit, moderation.
- **Slug**: the path segment that identifies a pad (`/mellow-otter-42`). Flat, lowercase letters, digits and hyphens, 1 to 64 characters, accents folded (ADR-0003). The slug *is* the pad's identity; there is no separate ID.
- **Room**: the server-side authority for one pad: a Cloudflare Durable Object (via y-partyserver) holding live connections, Yjs state and SQLite persistence. One pad, one room.
- **Identity**: a visitor's auto-generated name and colour (for example "Amber Fox"), kept in localStorage. Not an account; used only for presence.
- **Presence**: who is in the pad right now: avatars, coloured cursors and selections, carried over Yjs awareness.
- **Report**: a notice from the public report page that a pad should be looked at. Never proof that the pad exists.
- **Block**: the operator action that empties a pad and makes its slug show a removed notice (category and date only). The room enforces it (ADR-0002).
- **Pad index**: the small table of pads (slug, size, created, last edit, edit count) behind the admin page.

## Product invariants

1. **URL-first**: visiting `/:slug` opens the pad; an unknown slug becomes an editable empty pad. Nothing is stored or indexed until the first keystroke.
2. **No friction**: no account, no onboarding. The landing page is one input plus a random-address button.
3. **Public by design**: anyone with the address can read and edit; the operator can see every pad. The site says so in one line.
4. **Real-time by default**: simultaneous editing and presence are always on.
5. **Local resilience**: y-indexeddb caches every visited pad; a dropped connection loses nothing and merges on reconnect. A sync-status indicator is always visible.
6. **Not trapped**: download as `.md` or `.txt` from v1.
7. **Bounded blast radius**: about 1 MB per pad, about 50 connections per pad and a message size limit, all enforced in the room.

## Stack (see ADR-0001)

Vite and plain TypeScript, hand-written CSS · CodeMirror 6 · Yjs · y-codemirror.next · y-indexeddb · Cloudflare Workers · Durable Objects (SQLite-backed) · y-partyserver · WebSocket hibernation. One Worker, one `wrangler deploy`, starting on the free tier.

## Design spec

`docs/design/mockup.html` is the approved clickable mockup: landing, editor, preview, share sheet, every state, and the admin page.

## Deferred (not v1)

Version history, accounts, images and uploads, comments, command palette, idle cleanup.
