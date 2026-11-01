# ADR-0004: Cloudflare-native asset delivery and room tests

**Status:** accepted (2026-10-31)

## Context

Hashed JavaScript and CSS should be served by Cloudflare's static asset path,
not by Worker code: it is free and unlimited, while every Worker invocation is
billable and, on the free tier, answered with a `429` once the quota is spent.
Page responses still need the Worker for the Content Security Policy, crawler
previews and the canonical-host redirect.

Room behavior (connection admission, limits, persistence across eviction) can
only be proven in the Workers runtime, not in mocks.

## Decision

- `assets.not_found_handling` is `"none"`. A missing asset is a plain 404 and
  never the HTML shell, so a browser cannot cache HTML as JavaScript. The
  Worker serves the shell explicitly for page routes.
- `assets.run_worker_first` is `["/*", "!/assets/*"]`: the Worker handles every
  route except hashed assets. `public/_headers` therefore carries every header
  `/assets/*` needs (immutable caching, `nosniff`, referrer policy, HSTS), since
  the Worker never runs on them.
- A missing hashed chunk returns the asset router's bare 404, which inherits the
  immutable rule. That is survivable: content-hashed names are never reused, so
  a client recovers on its next load.
- Room tests use `@cloudflare/vitest-plugin` and run in `workerd` against the
  real SQLite-backed Durable Object. They run in one non-isolated worker, which
  is what WebSocket tests currently require.

## Consequences

- Static chunks cost no Worker invocations; free-tier headroom goes to pages and
  WebSockets.
- What a client receives for a missing asset is only provable against a running
  server, so the Workers-runtime tests do not cover it.
- The test toolchain adds Vitest and Cloudflare's plugin as development
  dependencies; production output is unaffected.

## Rejected

- `run_worker_first: true`: every chunk becomes a billable invocation (several
  times the requests on a cold load) and quota exhaustion takes the whole
  bundle down instead of only dynamic routes.
- `not_found_handling: "single-page-application"`: the asset router would answer
  a missing chunk with `index.html` at 200, which `_headers` would then pin as
  immutable.
- Mock-based room tests: they would not exercise Durable Object storage,
  eviction or partyserver behavior.
