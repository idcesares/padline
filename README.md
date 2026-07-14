# Padline

URL-first, no-account, real-time collaborative pads. A modern Dontpad successor.

Open a URL → it's a pad. Share the link → you're collaborating. A pad is a lightweight Notion-style page with live cursors, presence, offline resilience, and snapshot history.

## Stack

React 19 · Vite · Tailwind v4 · shadcn/ui · BlockNote · Yjs · Hono · Cloudflare Workers · Durable Objects (SQLite) · y-partyserver

The whole app is one Worker: static assets, HTTP API, and one Durable Object room per pad. See `CONTEXT.md` for the domain model and `docs/adr/` for why each decision was made.

## Development

```sh
npm install
npm run dev      # Vite dev server with the Worker running locally
npm run build    # typecheck + production build
npm run deploy   # build + wrangler deploy
```

Requires a Cloudflare account for deploys (`wrangler login`). Runs on the free tier.
