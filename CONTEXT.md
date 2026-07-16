# Padline — Domain Context

Padline is a URL-first, no-account, real-time collaborative pad. Visiting a URL *is* opening (or creating) a document. A pad is a lightweight Notion-style page, not a plain text file.

## Ubiquitous language

- **Pad** — one collaborative document, identified by its slug. The unit of everything: sharing, storage, history, protection.
- **Slug** — the path segment that identifies a pad (`/mellow-otter-42`). Validated (length, charset, reserved words). The slug *is* the pad's identity; there is no separate ID.
- **Room** — the server-side authority for one pad: a Cloudflare Durable Object (via y-partyserver) holding live connections, Yjs state, and SQLite persistence. One pad ↔ one room.
- **Snapshot** — a compact, restorable capture of a pad's content, taken on an idle trigger after edits. The unit of history. Restoring a snapshot is itself an edit (undoable), never a rollback.
- **PIN** — an optional per-pad secret that gates *everything* (view and edit), enforced server-side before any document bytes are sent. Stored hashed in the room.
- **Read-only link** — a secondary URL with a random token that connects in view-only mode. Enforced by the room (writes refused on that connection), not by UI.
- **Identity** — a visitor's auto-generated name + color (e.g. "Amber Fox"), stored in localStorage, editable via the presence avatar popover. Not an account; purely for presence.
- **Presence** — who is in the pad right now: avatars, live cursors, selections. Carried over Yjs awareness.
- **Takedown** — operator enforcement on a reported pad (ADR-0010): *purge* wipes content, snapshots, and secrets; *block* makes the slug refuse access and show a removed notice instead of minting a fresh pad. Slug-addressed and secret-gated; there is no pad registry or dashboard.

## Product invariants

1. **URL-first**: visiting `/:slug` opens the pad; if it doesn't exist it becomes an editable empty pad. A room is not persisted until the first keystroke (typos and crawlers mint nothing).
2. **No friction**: no account, no onboarding. The landing page's default action generates a random readable slug; memorable custom paths remain first-class.
3. **Real-time by default**: simultaneous editing, cursors, presence — always on.
4. **Local resilience**: y-indexeddb caches every visited pad; brief disconnections lose nothing and merge on reconnect. A sync-status indicator is always visible. (Not a PWA — the app shell requires network.)
5. **Not trapped**: Markdown export (copy + download) ships from v1.
6. **Bounded blast radius**: every pad enforces a document size cap (~2MB Yjs state), connection caps, and message size limits inside its room.

## Stack (decided — see ADRs for why)

React 19 · Vite SPA + React Router · Tailwind v4 · shadcn/ui · BlockNote · Yjs · y-indexeddb · Hono · Cloudflare Workers · Durable Objects (SQLite-backed) · y-partyserver · WebSocket hibernation. One Worker, one `wrangler deploy`, starting on the free tier.

## Explicitly deferred (phase 2+)

Hosted images/attachments (bundled with Turnstile + in-app reporting — operator-side takedown ops already exist, see ADR-0010), Markdown import, expiration ("self-destruct pads" as a feature, not hygiene), accounts & private pads, CI/CD pipeline, comments, AI features.
