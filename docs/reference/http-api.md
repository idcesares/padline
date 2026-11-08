# HTTP and WebSocket reference

Everything a client can call. There is no REST API for pads: a pad is a WebSocket room.

## Pages

| Request | Response |
| --- | --- |
| `GET /` and any `GET /<path>` | The HTML shell (`index.html`). The client decides what the path means. |
| `GET /<slug>` from a known link-preview crawler | A small generic HTML page with Open Graph tags and `noindex`. It never reads the pad. |
| `GET /assets/*` | Served by Cloudflare, not the Worker. A missing file is a plain 404. |
| Any request on `www.padline.page` or `padline.dcesares.dev` | `301` to the same path on `padline.page`. |

## HTTP

| Request | Response |
| --- | --- |
| `GET /api/health` | `200` `{"ok":true}` |
| `POST /api/report` | Files a report. Always `200` `{"ok":true}` for a well-formed body, whether or not the pad exists. |
| `/api/admin/*` | Operator API, see [Admin API](#admin-api). |
| `GET /admin` | The admin page (same shell, lazy chunk). Behind Cloudflare Access. |
| `GET /api/*` (anything else) | `404` `{"error":"not-found"}` |

### `POST /api/report`

JSON body, at most 4 KiB, no cookies and no IP address stored:

```json
{ "slug": "some-pad", "category": "spam", "note": "optional, 280 characters", "contact": "optional, 120" }
```

`category` is one of the fixed list in `shared/moderation.ts`. A malformed body is `400`; a slug with 50 open reports still answers `200`, and so does a reserved or invalid address (nothing is stored for it).

### Admin API

Every call needs a valid Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`); without one, or with `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` empty, the answer is `403`. `POST` also requires a same-origin `Origin`.

| Request | Response |
| --- | --- |
| `GET /api/admin/pads?filter=&q=` | `{ "pads": [...] }`. `filter` is `recent`, `largest`, `active`, `reported` or `blocked`. At most 50 rows. |
| `GET /api/admin/counts` | `{ reported, blocked, active }`: numbers only. `reported` is distinct slugs with an open report, `blocked` is pads with status `blocked`, `active` is pads edited in the last 24 hours. Feeds the tab badges. |
| `GET /api/admin/pads/<slug>` | `{ slug, pad, reports, excerpt }`; `excerpt` is `null` when the pad has no text or is blocked. |
| `POST /api/admin/pads/<slug>/clear` | Empties the document in the room, then logs the action. `409` `{"error":"blocked"}` if the pad is blocked; `404` `{"error":"not-found"}` if the index has never seen the slug. |
| `POST /api/admin/pads/<slug>/block` | Body `{ "category" }`. Deletes the document, closes sockets with `4404`, logs the action. Works on a slug the index has not seen. `409` `{"error":"blocked"}` if already blocked: the first category and date stay. |
| `POST /api/admin/pads/<slug>/dismiss` | Closes the open reports for the slug and logs the action. |
| `GET /api/admin/actions` | `{ "actions": [{ at, action, slug, category }] }`, newest first. |

A slug that is invalid or has a malformed percent-escape is `400` `{"error":"invalid-slug"}`.

If the room acted but the database write failed, the answer is `503` and the action stays in effect. Repeating a `block` then finishes the record, using the category the room kept.

## Pad room

The party is `pad-room`; the room name is the slug. Both routes live under `/parties/pad-room/<slug>`.

### `GET /parties/pad-room/<slug>?op=status`

What a visitor may learn about a pad that was removed.

```json
{ "removed": null }
```

```json
{ "removed": { "at": 1767225600000, "category": "spam" } }
```

`at` is a Unix time in milliseconds; `category` may be `null`. The operator's reason is never returned. A pad that exists and is not blocked looks the same as one that does not exist.

Any other `op`, or any method other than `GET`, returns `404` `{"error":"unknown-op"}`. Any `op` starting with `admin-` on `/parties/*` returns the same, from the Worker, before it reaches a room.

### WebSocket `/parties/pad-room/<slug>`

Speaks the y-partyserver protocol: the Yjs sync handshake and the Yjs awareness protocol. The shared text is the Y.Text named `text`.

A connection is accepted only if the slug is valid, the pad is not blocked, and the room has no more than 50 connections.

#### Close codes

| Code | Reason string | Meaning |
| --- | --- | --- |
| `4400` | `invalid-slug` | The slug is invalid or reserved. |
| `4404` | `pad-removed` | The pad is blocked. Ask `?op=status` for the category and date. |
| `1013` | `pad-busy` | The room is at its connection cap. Retry later. |
| `1009` | `message-too-large` | A message exceeded 256 KiB. |

#### Custom messages

Sent by the room as y-partyserver custom messages:

| Message | When |
| --- | --- |
| `pad-full` | The document crossed 1 MiB, and to anyone who connects while it is over. |
| `pad-ok` | The document is back under the limit. |

## Security headers

See [Configuration](configuration.md#headers).
