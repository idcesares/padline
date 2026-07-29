# ADR-0011: Cloudflare-native asset delivery and room verification

**Status:** accepted (2026-07-17)

## Context

Padline's first production build sent every request through Worker code because
`assets.run_worker_first` was `true`. That kept dynamic CSP headers simple, but
it also placed content-hashed JavaScript and CSS behind an unnecessary Worker
invocation instead of Cloudflare's direct static asset path. The React entry
module also imported the editor route eagerly, making the landing page pay for
the BlockNote collaboration graph.

The room's security and resilience invariants were covered only by a smoke
script against a manually started server. That could not directly exercise
Durable Object eviction, and it left partyserver details such as whether the
connecting socket is already present in `getConnections()` implicit.

## Decision

- Keep the root app shell Worker-first. `public/_headers` gives content-hashed
  assets immutable browser caching and preserves hardening headers.
- Missing `/assets/*` requests must return a non-cacheable 404. They must never
  receive the SPA fallback because browsers would otherwise cache HTML as
  JavaScript after a deployment.

  **Amended 2026-07-29.** As originally written this decision assumed the
  Worker could answer that 404 while Cloudflare still served `/assets/*`
  directly. It cannot: a negative `run_worker_first` pattern never invokes the
  Worker, not even on a miss. Paired with
  `not_found_handling: "single-page-application"`, that silently produced the
  exact failure this decision forbids — a missing chunk was answered by the
  asset router with `index.html` at `200`, which `public/_headers` then stamped
  `immutable, max-age=31536000`, so clients cached HTML as JavaScript for a
  year. The Worker's guard was unreachable dead code throughout.

  The fix is `not_found_handling: "none"`, which stops the shell being served
  at an asset URL. The residue is that the asset router's bare 404 still
  inherits the immutable `/assets/*` rule. Eliminating that too would require
  `run_worker_first: true`, and it was measured and rejected: it makes every
  chunk a billable Worker invocation (~4x on a landing load, ~10x on a cold pad
  load) and, on the free tier, turns quota exhaustion into a `429` on the
  entire bundle instead of assets continuing to serve. Platform sustainability
  outranks a cached empty 404 whose damaging case — a chunk that 404s
  transiently during a deploy and is then pinned for a year — is narrow, since
  deploys go to 100% at once and the common stale-chunk case resolves on the
  next reload with fresh chunk names.

  So: `run_worker_first` keeps `!/assets/*`, assets stay free, and the
  non-cacheable 404 is downgraded to a non-HTML 404. This costs nothing in
  hardening — `public/_headers` already applies `nosniff` and `Referrer-Policy`
  to `/assets/*`, and CSP is a document-level header that only matters on the
  HTML responses, which remain Worker-first. The Worker's `/assets/*` branch is
  kept, dormant, written to serve assets correctly should the exclusion ever be
  dropped.
- Keep page responses Worker-first so crawler metadata and the hostname-aware
  Content Security Policy remain dynamic.
- Lazy-load the landing, legal, and pad route modules. The editor graph is
  fetched only when a visitor opens a pad.
- Use `@cloudflare/vitest-pool-workers` for room integration tests. Tests run in
  `workerd` with the configured SQLite-backed Durable Object and cover the HTTP
  interface, WebSocket admission, and state reconstruction after eviction.
- Run WebSocket tests with one non-isolated Vitest worker, matching the current
  limitation documented by Cloudflare's Workers Vitest integration.

## Consequences

- Hashed assets avoid billable Worker execution and receive long-lived
  immutable browser caching while page behavior and security headers stay
  unchanged. Free-tier request headroom is spent on pages, API calls, and room
  websockets rather than on static chunks.
- A request for a hashed chunk that does not exist returns an empty 404 that
  may be cached for a year. This is survivable because content-addressed names
  are never reused: the chunk that 404s is one that genuinely no longer exists,
  and the client recovers on its next load with new chunk names.
- What a client actually receives for a missing asset is only provable against
  a running server, so it is asserted in `scripts/api-smoke.mjs`. The
  Workers-runtime test calls the entrypoint directly and keeps passing whether
  or not `wrangler.jsonc` routes `/assets/*` to the Worker at all — which is
  precisely how the SPA-shell regression shipped unnoticed.
- The landing page no longer downloads the editor route before it is needed.
- Room tests verify Cloudflare runtime semantics instead of duplicating them in
  mocks. In particular, the exact 50-connection invariant is executable:
  partyserver includes the connecting socket in `getConnections()`, so the
  room's `connections.length > MAX_CONNECTIONS` comparison is intentional.
- A durable over-cap marker keeps a frozen room frozen across eviction.
  Restoring an accepted snapshot or performing an admin purge clears it.
- The test toolchain adds Vitest and Cloudflare's pool as development
  dependencies; production output is unaffected.

## Rejected

- **Set `run_worker_first` to false globally.** This would make asset delivery
  simple, but page responses would lose the Worker's dynamic crawler metadata
  and hostname-aware CSP path.
- **Pure Node tests for extracted room policy helpers.** Extracting shallow
  helpers only for tests would reduce locality and still would not prove
  Durable Object, SQLite, eviction, or partyserver behavior.
- **Smoke tests only.** They remain valuable for deployed-system checks, but
  they are slower, require process orchestration, and cannot inspect or evict a
  room deterministically.
