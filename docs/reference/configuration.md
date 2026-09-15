# Configuration & limits

Every setting an instance has, where it lives, and the built-in limits.

- [Secrets and variables](#secrets-and-variables)
- [Cloudflare bindings](#cloudflare-bindings)
- [Moderation profile](#moderation-profile)
- [Built-in limits](#built-in-limits)
- [Edge rules (dashboard)](#edge-rules-dashboard)
- [Browser storage](#browser-storage)

## Secrets and variables

Set in production with `npx wrangler secret put <NAME>`; locally in `.dev.vars`
(gitignored).

| Name | Required for | If unset | Local value |
| --- | --- | --- | --- |
| `ADMIN_SECRET` | The moderation API and CLI | The admin surface answers `404 unknown-op` to everyone. | Any long random value. The CLI and smoke suite read it from `.dev.vars`. |
| `TURNSTILE_SECRET` | Accepting public reports | `POST /api/reports` answers `503`. | `1x0000000000000000000000000000000AA` (Turnstile's always-pass test secret) |
| `TURNSTILE_SITE_KEY` | Showing the report form | The form says reporting is unavailable. Public — served by `GET /api/reports/config`. | `1x00000000000000000000AA` |

Never deploy Turnstile's test keys; the smoke suite fails a remote host that does.

Rotating `ADMIN_SECRET` takes effect on the next request. Rotating Turnstile keys
needs both keys from the same widget.

The test suite sets its own values in `vitest.config.ts` and answers Turnstile's
verification locally.

## Cloudflare bindings

Declared in `wrangler.jsonc`.

| Binding | Kind | Purpose |
| --- | --- | --- |
| `PadRoom` | Durable Object (SQLite), migration `v1` | One room per pad: live connections, document, snapshots, PIN, links, block, freeze. |
| `ModerationLedger` | Durable Object (SQLite), migration `v2` | One instance named `ledger`: reports, cases, evidence, action log. |
| `ASSETS` | Static assets | The built app. |

`routes` lists the custom domains; `assets.run_worker_first` sends everything
except `/assets/*` through the Worker (see ADR-0011 before changing it). The dev
server is pinned to `127.0.0.1:8788` in `vite.config.ts`.

## Moderation profile

`src/lib/moderation-profile.ts` — every moderation value that encodes one
jurisdiction's rules rather than Padline's mechanism
([ADR-0018](../adr/0018-notice-and-action-moderation.md)). The repository ships
`padline.page`'s Brazilian assessment; a fork replaces it
([why](../operating-a-public-instance.md)).

| Field | `padline.page` value | Used for |
| --- | --- | --- |
| `jurisdiction` | `BR` | Labelling the profile. |
| `label` | Brazil — padline.page operator (individual, non-commercial) | Labelling the profile. |
| `assessedAt` | `2026-09-13` | When the values were assessed. |
| `operatorContact` | `contact@padline.page` | Policy pages and the report form's fallback. |
| `categories` | 12 ids, 5 grave — [list](cli.md#categories) | Report categories and case priority. |
| `reviewTargetHours` | grave `24`, standard `72` | `stats` timing targets. |
| `evidenceRetentionDays` | `180` | Days evidence is kept after its case closes. |
| `reporterContactRetentionDays` | `180` | Days a reporter's email is kept after the case closes. |

Rules for changing it:

- **Category ids are stored in the ledger** — add categories or change `grave`
  freely, but don't rename an id your instance has already used.
- **Every category needs a visitor-facing name** in `src/lib/moderation-labels.ts`
  (TypeScript enforces it).
- Policy wording and authority referral channels are not in the profile — they're
  prose in `src/routes/legal.tsx` and your runbook.

## Built-in limits

Constants in the code. Changing one is a product decision — see the ADR.

| Limit | Value | Where | ADR |
| --- | --- | --- | --- |
| Pad address length | 1–64 characters, `a-z 0-9 -` | `src/lib/slug.ts` | 0004 |
| Reserved addresses | `api assets parties p r admin terms privacy content-policy legal about report` | `src/lib/slug.ts` | 0004 |
| Document size | 2 MB (then edits are refused until a restore or purge) | `worker/room-persistence.ts` | 0008 |
| Save debounce | 2 s, at most 10 s | `worker/index.ts` | 0003 |
| Snapshot frequency / retention | at most 1 per 60 s / newest 100 | `worker/room-persistence.ts` | 0006 |
| Connections per pad | 50 | `worker/index.ts` | 0008 |
| Connections per IP per pad | 8 | `worker/index.ts` | 0008 |
| WebSocket message size | 256 KB | `worker/index.ts` | 0008 |
| PIN length | 4–64 characters | `worker/room-security.ts` | 0009 |
| PIN backoff | 5 free attempts, then 1 s doubling to 60 s | `worker/room-security.ts` | 0009 |
| PIN session lifetime / count | 30 days / 200 per pad | `worker/room-security.ts` | 0009 |
| Operator review preview | 64 KB of text | `worker/room-capabilities.ts` | 0010 |
| Operator reason / legal basis | 500 characters | `worker/moderation-ledger.ts` | 0018 |
| Report description / contact | 2,000 / 254 characters | `worker/moderation-ledger.ts` | 0018 |
| Turnstile token | 2,048 characters | `worker/turnstile.ts` | 0018 |
| Evidence chunk size | 1 MB (SQLite's BLOB limit is 2 MB) | `worker/moderation-ledger.ts` | 0018 |
| Retention sweep | daily | `worker/moderation-ledger.ts` | 0018 |

## Edge rules (dashboard)

Not in the repository; configure per instance in Cloudflare (Security → WAF →
Rate limiting rules). Recommended: per-IP limits on `/api/reports`, on PIN
verification (`/parties/*` with `op=verify-pin`), and on new pad paths. See
[Self-hosting](../self-hosting.md#protect-it-at-the-edge).

## Browser storage

What the app keeps on the visitor's device:

| Key | Storage | Holds |
| --- | --- | --- |
| `padline:identity` | localStorage | Display name and color |
| `padline:theme` | localStorage | `light` / `dark` |
| `padline:statusline` | localStorage | `on` / `off` |
| `padline:token:<slug>` | localStorage | PIN session token for that pad |
| `padline:<slug>` | IndexedDB | Offline copy of that pad |
