# HTTP & WebSocket API

Every surface the Worker exposes. The browser app and `scripts/admin.mjs` use
exactly these; nothing else is reachable.

- [Conventions](#conventions)
- [Pad room — HTTP](#pad-room--http)
- [Pad room — WebSocket](#pad-room--websocket)
- [Public reports](#public-reports)
- [Moderation API](#moderation-api) (operator only)
- [Records](#records)
- [Other routes](#other-routes)

## Conventions

- Bodies are JSON. Errors are `{ "error": "<code>" }` with the status shown.
- An **unknown or unauthorized operation always answers
  `404 { "error": "unknown-op" }`** — it never says whether the operation exists
  or the secret was wrong.
- Pad addresses (`:slug`) must be valid slugs: `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`,
  not reserved (`api`, `assets`, `parties`, `p`, `r`, `admin`, `terms`, `privacy`,
  `content-policy`, `legal`, `about`, `report`).
- Times are epoch milliseconds.

## Pad room — HTTP

Base: `/parties/pad-room/:slug?op=<op>`. `token` is a PIN session token, passed
as `&token=…`.

| Op | Method | Auth | Body | Success |
| --- | --- | --- | --- | --- |
| `info` | GET | none | — | `{ pinProtected }`, plus `frozen: true, frozenAt, category?` when frozen |
| `verify-pin` | POST | none | `{ pin }` | `{ token }` |
| `set-pin` | POST | `token` if the pad has a PIN | `{ pin }` or `{ remove: true }` | `{ token }` / `{ ok: true }` |
| `ro-token` | GET | `token` if PIN | — | `{ token }` — the read-only link token (created on first request) |
| `ro-token` | POST | `token` if PIN | — | `{ token }` — a new token; old links stop connecting |
| `snapshots` | GET | `token` if PIN | — | `[{ id, createdAt, size }]`, newest first |
| `restore` | POST | `token` if PIN | `{ id }` | `{ ok: true }` — applied as a new edit |

Errors:

| Status | Error | When |
| --- | --- | --- |
| 400 | `bad-json` | Body isn't JSON. |
| 400 | `no-pin` | `verify-pin` on a pad without a PIN. |
| 400 | `invalid-pin` | PIN shorter than 4 or longer than 64 characters (after trimming). |
| 401 | `unauthorized` | Missing or expired session on a PIN-protected pad. |
| 403 | `wrong-pin` | Wrong PIN. |
| 404 | `not-found` | `restore` of a snapshot that doesn't exist. |
| 404 | `unknown-op` | Unknown op — and **every `admin-*` op on this public route**, whatever secret is sent. |
| 410 | `pad-removed` | Any op except `info` on a blocked pad. |
| 423 | `pad-frozen` | `set-pin` or `restore` on a frozen pad. |
| 429 | `too-many-attempts` | PIN backoff; body has `retryInMs`, header `retry-after` (seconds). |

A **blocked** pad answers `info` with
`{ pinProtected: false, removed: true, removedAt, category? }`. The operator's
reason is never included in any public response.

**PIN rules:** after 5 wrong attempts, each further attempt waits 1 s × 2ⁿ, up to
60 s; a correct PIN resets the count. Setting or removing a PIN invalidates all
sessions. Sessions last 30 days; a pad keeps its 200 newest.

## Pad room — WebSocket

```
wss://<host>/parties/pad-room/:slug                 # unprotected pad
wss://<host>/parties/pad-room/:slug?token=<session> # PIN-protected pad
wss://<host>/parties/pad-room/:slug?ro=<ro-token>   # read-only link
```

The protocol is y-partyserver's Yjs sync and awareness. Authorization happens
before any document bytes are sent; read-only connections can't write.

The browser app's read-only link is `https://<host>/:slug?v=<ro-token>`; the app
connects with `ro=`.

**Close codes:**

| Code | Reason | Meaning |
| --- | --- | --- |
| 1009 | `message-too-large` | A message over 256 KB. |
| 1013 | `pad-full` | The pad already has 50 connections. |
| 1013 | `too-many-connections` | 8 connections from this IP to this pad. |
| 4400 | `invalid-slug` | Not a valid pad address. |
| 4401 | `pin-required` | PIN-protected; no valid session. |
| 4403 | `invalid-token` | Bad or rotated read-only token. |
| 4404 | `pad-removed` | The pad is blocked. |
| 4408 | `disconnected` | The operator disconnected everyone; reconnecting is allowed. |
| 4409 | `pad-frozen` | The operator froze the pad; reconnect read-only. |

A pad over the ~2 MB document limit stays connected but refuses edits until a
snapshot is restored or it's purged.

## Public reports

### `GET /api/reports/config`

`200 { "siteKey": "<turnstile site key>" | null }` — `null` when reporting isn't
configured.

### `POST /api/reports`

```json
{
  "pad": "some-pad or https://padline.page/some-pad",
  "kind": "violation",
  "category": "phishing-malware",
  "description": "optional, up to 2000 characters",
  "contact": "optional, up to 254 characters",
  "turnstileToken": "<token from the Turnstile widget>"
}
```

- `kind`: `violation` (default), `removal-request`, or `appeal`.
- `category`: a [category id](cli.md#categories).
- `pad`: a slug, `/slug`, or pad URL; only the first path segment counts.

| Status | Body | When |
| --- | --- | --- |
| **202** | `{ ok: true, reference }` | Any well-formed report — **the same whether the pad exists, is blocked, or already has a case**. `reference` is 12 random hex characters. |
| 400 | `bad-json`, `invalid-slug`, `invalid-kind`, `invalid-category`, `invalid-description`, `invalid-contact` | Malformed report (checked after Turnstile). |
| 403 | `verification-failed` | Missing, invalid, or reused Turnstile token. Nothing is stored. |
| 503 | `reporting-unavailable` | No `TURNSTILE_SECRET` deployed, or Turnstile couldn't be reached. |

No IP address or client metadata is stored. A report never creates a pad.

## Moderation API

Base: `/api/admin`. Every request needs `Authorization: Bearer <ADMIN_SECRET>`;
anything else answers `404 unknown-op`.

| Method & path | Body / query | Response |
| --- | --- | --- |
| `POST /cases` | `{ slug, kind, category, source, description?, contact? }` | `201` new / `200` attached: `{ case, created, reportId, reference }` |
| `GET /cases` | `?status=&priority=&slug=` | `{ cases: Case[] }`, grave first, then oldest |
| `GET /cases/:id` | — | `{ case, reports, evidence, actions }` |
| `POST /cases/:id/actions` | [action body](#action-body) | [action response](#action-response) |
| `GET /pads/:slug` | — | A case-less review: `{ actions, result }` |
| `GET /evidence/:id` | — | `{ evidence }` |
| `GET /evidence/:id/download` | — | `{ evidence, doc: <base64>, text }` — logged first |
| `POST /evidence/:id/hold` | `{ reason }` | `{ evidence, actions }` |
| `POST /evidence/:id/release` | `{ reason }` | `{ evidence, actions }` |
| `GET /stats` | `?from=&to=` (epoch ms, half-open) | Totals and timing — see [`stats`](cli.md#stats) |
| `GET /export/:table` | `table` = `reports`\|`cases`\|`actions`\|`evidence`; `?format=json\|csv&from=&to=&includeContact=1` | JSON `{ table, from, to, rows }` or `text/csv` — logged first |
| `POST /reconcile` | — | `{ reconciled: Action[] }` |
| `GET /actions/verify` | — | `{ ok: true, count }` or `{ ok: false, count, brokenAt }` |

`POST /cases` source is one of `form`, `email`, `cloudflare`, `authority`, `other`.

### Action body

```json
{ "action": "remove", "reason": "…", "legalBasis": "…", "block": true, "withoutEvidence": false }
```

`action`: `review`, `capture`, `freeze`, `unfreeze`, `disconnect`, `block`,
`unblock`, `purge`, `remove`, `dismiss`, `close`. `reason` is required except for
`review` and `capture`. `block` and `withoutEvidence` apply to `purge`.

### Action response

```json
{
  "case": { "…": "the case after the action" },
  "actions": [ { "…": "intent (outcome: pending)" }, { "…": "outcome (ok | failed)" } ],
  "result": { "…": "the pad's answer; for capture, { evidence }" },
  "evidence": { "…": "remove only: the sealed evidence" }
}
```

On failure: `502 { case, actions, error: "room-failed", detail }`.

| Status | Error | When |
| --- | --- | --- |
| 400 | `bad-json`, `invalid-action`, `invalid-reason`, `invalid-legal-basis`, `reason-required` | Malformed action. |
| 400 | `invalid-slug`, `invalid-kind`, `invalid-category`, `invalid-source`, `invalid-description`, `invalid-contact` | Malformed `POST /cases`. |
| 400 | `invalid-range`, `invalid-format` | `stats` / `export` parameters. |
| 404 | `not-found` | No such case or evidence. |
| 409 | `case-closed` | The case is `closed` or `dismissed`. |
| 409 | `capture-not-allowed`, `remove-not-allowed` | On a removal request. |
| 409 | `evidence-required` | `purge` of a violation with no evidence and no `withoutEvidence`. |
| 410 | `evidence-expired` | Evidence deleted by retention. |
| 502 | `room-failed` | The pad didn't confirm the action; the failure is recorded. |

## Records

**Case** — `id, slug, kind, category, priority (grave|standard), status, openedAt,
firstReviewedAt, actionedAt, closedAt, decision, legalBasis, reports` (notice count).

**Report** — `id, reference, receivedAt, slug, category, description, contact,
source, caseId`.

**Action** — `seq, at, caseId, slug, action, reason, paramsJson, outcome
(pending|ok|failed), prevHash, hash`. Besides case actions, the log records
`case-opened`, `notice-attached`, `evidence-download`, `evidence-hold`,
`evidence-release`, `evidence-expired`, `contact-expired`, and `export`.
`hash` = SHA-256 of `[seq, at, caseId, slug, action, reason, paramsJson, outcome, prevHash]`
as JSON; the first entry's `prevHash` is 64 zeros.

**Evidence** — `id, caseId, slug, capturedAt, docBytes, docSha256, textBytes,
textSha256, meta` (pad state at capture), `retainUntil, hold, deletedAt`.

## Other routes

| Route | Behavior |
| --- | --- |
| `GET /api/health` | `200 { ok: true }` |
| `GET /:slug` from a crawler (Slack, Discord, WhatsApp, Googlebot, …) | Minimal HTML with Open Graph tags and `noindex`. |
| `GET /:slug`, `/`, `/report`, policy pages | The app. |
| `/assets/*` | Hashed static assets from the edge; a missing chunk is a non-cacheable `404`, never HTML. |
| `www.padline.page`, `padline.dcesares.dev` | `301` to `padline.page`. |

All HTML responses carry `x-content-type-options: nosniff` and
`referrer-policy: no-referrer`; outside localhost also a Content-Security-Policy
(only `https://challenges.cloudflare.com` as a third-party script and frame
origin) and HSTS (one year, subdomains, no preload).
