# ADR-0003: Self-hosted collaboration on Durable Objects via y-partyserver

**Status:** accepted (2026-07-14)

## Context

Hosting cost matters: personal project, must start free, must scale without re-architecture. Durable Objects (SQLite-backed) are available on the Workers free tier with WebSocket hibernation. Managed alternatives (Liveblocks) price per collaborator — the worst axis for a "share a URL with anyone, no accounts" product.

## Decision

One pad ↔ one SQLite-backed Durable Object ("room"), using Cloudflare's y-partyserver to implement the Yjs WebSocket protocol instead of hand-rolling it. Hono routes HTTP + WebSocket upgrade. The whole app is one Worker and one `wrangler deploy`, starting on the free tier (100k req/day, 5GB storage) and scaling by flipping to the $5/mo paid plan.

## Consequences

- ~$0 until real traffic; no per-user pricing cliff; we own the data.
- Each pad has one coordination point: geographically distant collaborators see ~100–200ms extra sync latency. Fine for text collaboration.

## Rejected

- Liveblocks (per-MAU/collaborator pricing cliff; data lives with them).
- y-sweet / y-websocket on Fly/Railway (servers to manage; contradicts low-ops goal).
