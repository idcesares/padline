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

- Keep the root app shell Worker-first. Let Cloudflare serve matching static
  assets directly; `public/_headers` gives content-hashed assets immutable
  browser caching and preserves hardening headers.
- Let missing `/assets/*` requests fall through to the Worker and return a
  non-cacheable 404. They must never receive the SPA fallback because browsers
  would otherwise cache HTML as JavaScript after a deployment.
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

- Hashed assets avoid billable Worker execution and receive long-lived browser
  caching while page behavior and security headers stay unchanged.
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
