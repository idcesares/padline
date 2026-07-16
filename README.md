# Padline

**URL-first, no-account, real-time collaborative pads.** A modern [Dontpad](http://dontpad.com) successor.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Deployed on Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Live at [padline.dcesares.dev](https://padline.dcesares.dev)** — open any URL and start typing.

Open a URL → it's a pad. Share the link → you're collaborating. A pad is a lightweight Notion-style page with live cursors, presence, offline resilience, and snapshot history. No accounts, no onboarding, no friction.

## Features

- ✏️ **Rich collaborative editing** — Notion-style blocks (BlockNote) over Yjs CRDTs; simultaneous edits merge conflict-free
- 👥 **Presence** — live cursors, selections, and auto-generated identities ("Mellow Otter") you can rename
- 🔗 **URL-first** — `padline.dcesares.dev/anything-you-like` *is* the pad; empty pads cost nothing until the first keystroke
- 🔒 **PIN protection** — optional per-pad PIN gates both viewing and editing, enforced server-side with brute-force backoff
- 👁️ **Read-only links** — share a view-only capability URL; rotate it anytime to revoke old copies
- 🕘 **Snapshot history** — automatic snapshots on idle; restoring is itself an undoable edit, never a rollback
- 📴 **Offline resilience** — every visited pad is cached in IndexedDB; brief disconnections lose nothing
- 📤 **Markdown export** — copy or download; your content is never trapped
- 🛡️ **Abuse invariants** — document size caps, connection caps, message limits, per-IP caps ([ADR-0008](docs/adr/0008-abuse-invariants-only-in-v1.md), [ADR-0009](docs/adr/0009-brute-force-and-token-lifetime-hardening.md))

## How it works

The whole app is **one Cloudflare Worker**: static assets, HTTP API, and one Durable Object room per pad.

```mermaid
flowchart LR
    B[Browser<br/>React + BlockNote + Yjs] -->|"WebSocket (Yjs sync + awareness)"| W[Cloudflare Worker<br/>Hono + partyserver routing]
    B -->|"HTTP ops (PIN, tokens, snapshots)"| W
    W --> DO["Durable Object per pad<br/>(y-partyserver room)"]
    DO --> S[("SQLite storage<br/>doc + snapshots + auth")]
    B <-->|offline cache| IDB[(IndexedDB)]
```

- A **pad** is identified by its slug — the URL path. One pad ↔ one Durable Object room holding live connections, the Yjs document, snapshot history, and the PIN/read-only gates.
- Authorization happens **before any document bytes are sent**: PIN-protected pads refuse the WebSocket until a valid session token is presented; read-only links connect with a capability token the room enforces.
- Documents persist to SQLite-backed Durable Object storage; snapshots are taken on an idle trigger and capped at 100 per pad.

**Stack**: React 19 · Vite · Tailwind v4 · shadcn/ui · BlockNote · Yjs · y-indexeddb · Hono · Cloudflare Workers · Durable Objects (SQLite) · y-partyserver

See [`CONTEXT.md`](CONTEXT.md) for the domain model and ubiquitous language, and [`docs/adr/`](docs/adr/) for why each decision was made.

## Quickstart

```sh
git clone https://github.com/idcesares/padline.git
cd padline
npm install
npm run dev      # http://127.0.0.1:8788 — Vite + the Worker running locally
```

Open `http://127.0.0.1:8788/my-first-pad` and start typing. Open the same URL in a second tab to see collaboration live.

> **Windows note**: the dev server is pinned to `127.0.0.1:8788` because Windows reserves the 5142–5241 port range. `.npmrc` sets `legacy-peer-deps` to reconcile a peer-dependency mismatch between `partyserver` and `wrangler`.

## Deploy your own

Padline runs entirely on the Cloudflare free tier — one command deploys everything:

```sh
npx wrangler login   # once
npm run deploy       # build + deploy Worker, assets, and Durable Objects
```

Your instance is live at `https://padline.<your-subdomain>.workers.dev`. To use a custom domain, edit the `routes` block in [`wrangler.jsonc`](wrangler.jsonc).

**Recommended**: add a per-IP rate-limiting rule in the Cloudflare dashboard (Security → WAF → Rate limiting) as the outer layer against PIN brute-forcing — the app enforces per-pad backoff on its own, but defense in depth is cheap.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with the Worker running locally |
| `npm run build` | Typecheck + production build |
| `npm run deploy` | Build + `wrangler deploy` |
| `node scripts/api-smoke.mjs` | 22-check smoke suite against the local dev server |
| `node scripts/api-smoke.mjs https://your-host` | Same suite against a deployed instance |

## Project structure

```
├── src/                  # React SPA
│   ├── routes/           #   landing + pad pages
│   ├── components/       #   presence, share dialog, history, UI primitives
│   ├── hooks/            #   theme, awareness
│   └── lib/              #   slug rules, pad HTTP API, identity
├── worker/               # Cloudflare Worker: routing, OG tags, PadRoom Durable Object
├── scripts/              # smoke tests (HTTP + WebSocket)
├── docs/
│   ├── adr/              # architecture decision records (the "why")
│   └── agents/           # conventions for AI-assisted development
├── CONTEXT.md            # domain model & ubiquitous language
└── wrangler.jsonc        # Cloudflare deployment config
```

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions (ADRs, smoke tests), and the PR flow. Security issues: see [SECURITY.md](SECURITY.md).

## License & author

[MIT](LICENSE) © [Isaac D'Césares](https://github.com/idcesares)
