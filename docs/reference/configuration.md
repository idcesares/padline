# Configuration and limits

Exact values. For the reasons, see [ADR-0003](../adr/0003-pad-lifecycle-and-limits.md) and [ADR-0004](../adr/0004-cloudflare-native-delivery-and-tests.md).

## Limits

All defined in `shared/limits.ts`.

| Limit | Value | Behavior past it |
| --- | --- | --- |
| Document state per pad (`MAX_DOC_BYTES`) | 1 MiB | Room stops saving and broadcasts `pad-full`. |
| Hard ceiling | 2 MiB | Room refuses edits (read-only). |
| WebSocket message (`MAX_MESSAGE_BYTES`) | 256 KiB | Connection closes with `1009`. |
| Live connections per pad (`MAX_CONNECTIONS`) | 50 | Extra connections close with `1013`. |
| Slug length | 1 to 64 | The address is invalid (`4400`). |

Slug rules and the reserved list are in `shared/slug.ts`.

## Cloudflare bindings

Defined in `wrangler.jsonc`.

| Binding | Type | Notes |
| --- | --- | --- |
| `PadRoom` | Durable Object (SQLite-backed) | One instance per slug. |
| `ASSETS` | Static assets | `not_found_handling: "none"`; `run_worker_first: ["/*", "!/assets/*"]`. |
| `DB` | D1 database `padline` | Pad index, reports and the action log ([ADR-0002](../adr/0002-lean-moderation.md)). Schema in `migrations/`. |

| Variable | Default | Notes |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | empty | Your Access team domain, for example `team.cloudflareaccess.com`. Not a secret. |
| `ACCESS_AUD` | empty | The Access application's AUD tag. Not a secret. |
| `ADMIN_DEV_BYPASS` | unset | Set to `1` in `.dev.vars` to open the admin page on `localhost` and `127.0.0.1` only. Ignored on any other host. |

With `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` empty, the admin surface answers `403` to everyone. There are no secrets.

Database scripts: `npm run db:migrate:local` applies `migrations/` to the local dev database. Remote: `npx wrangler d1 migrations apply padline --remote`.

## Migrations

| Tag | Adds |
| --- | --- |
| `v1` | `PadRoom` (SQLite-backed) |
| `v2` | `ModerationLedger` (inert placeholder, see `worker/moderation-ledger.ts`) |

Applied migrations are append-only. Removing the placeholder requires a `deleted_classes` migration and erases what that namespace stores.

## Routes

`padline.page`, `www.padline.page` and `padline.dcesares.dev`, as custom domains. `www` and the alternate domain redirect (301) to `padline.page`. Replace these in a fork.

## Headers

- Security headers on Worker responses: `x-content-type-options: nosniff`, `referrer-policy: no-referrer`.
- In production only: `strict-transport-security: max-age=31536000; includeSubDomains` and a Content Security Policy (`script-src 'self'`; styles and fonts from `self` and Google Fonts; `connect-src 'self'` plus `wss://<host>`; `frame-ancestors 'none'`).
- `/assets/*` bypasses the Worker, so `public/_headers` sets its cache and security headers.

## Public files

`public/robots.txt`, `public/sitemap.xml`, `public/llms.txt`, `public/humans.txt`, `public/favicon.svg`.

## Free tier

Cloudflare's free-tier figures for Workers requests and Durable Objects change over time and have not been verified for this project. Check the official pages before launch.
