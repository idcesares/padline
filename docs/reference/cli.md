# CLI reference — `scripts/admin.mjs`

The operator's command-line tool for the moderation ledger. For when to use each
command, see the [moderation guide](../moderation-guide.md).

```sh
node scripts/admin.mjs <host> <command> [arguments] [flags]
node scripts/admin.mjs --help
```

- [Basics](#basics)
- [Cases](#cases): `cases` · `case open` · `case <id>` · `case <id> <action>`
- [Evidence](#evidence): `evidence <id>` · `download` · `hold` · `release`
- [Pads](#pads): `pad <slug> info`
- [Bulk](#bulk): `bulk`
- [Totals and exports](#totals-and-exports): `stats` · `export`
- [Integrity](#integrity): `reconcile` · `verify-chain`
- [Values](#values): categories · kinds · sources · statuses

## Basics

**`<host>`** — `padline.page`, `https://padline.page`, or `127.0.0.1:8788`.
`localhost` and `127.*` use `http`; anything else uses `https` unless you write
the scheme.

**Secret** — read from the `ADMIN_SECRET` environment variable, then from
`.dev.vars` in the project root. Commands that contact a host fail without it.

**Output** — human-readable text on stdout; `export` writes raw JSON or CSV.

**Exit codes** — `0` on success; `1` on any refusal, error, broken chain, hash
mismatch, or (for `bulk`) any pad that failed.

**"Rejected as unknown-op"** — the secret is wrong, isn't deployed on that host,
or the host predates the moderation ledger. The server deliberately gives no
more detail.

**Every command that reads or changes a pad, downloads evidence, or exports data
is recorded in the action log.** Listing cases and reading totals are not.

## Cases

### `cases`

List cases, grave first, then oldest.

```sh
node scripts/admin.mjs <host> cases [--status <status>] [--priority grave|standard] [--slug <slug>]
```

Columns: case id, priority, status, kind, category, notice count, opened (UTC),
pad.

### `case open`

Record a notice that didn't come through the report form. Opens a case, or
attaches to the pad's open case of the same kind.

```sh
node scripts/admin.mjs <host> case open <slug> --category <id> \
  [--kind violation] [--source email] [--note "…"] [--contact "…"]
```

| Flag | Default | Notes |
| --- | --- | --- |
| `--category` | *required* | A [category](#categories) id. A grave category raises an existing case to grave. |
| `--kind` | `violation` | A [kind](#kinds). |
| `--source` | `email` | A [source](#sources). |
| `--note` | — | What the notice said. Up to 2,000 characters. |
| `--contact` | — | Reporter's email, up to 254 characters. Cleared after retention. |

### `case <id>`

Show one case: summary, notices (with reference codes and contacts), evidence,
and every recorded action.

```sh
node scripts/admin.mjs <host> case <id>
```

### `case <id> <action>`

Act on a case. Actions on a `closed` or `dismissed` case are refused.

```sh
node scripts/admin.mjs <host> case <id> <action> [--reason "…"] [--legal-basis "…"] [--block] [--without-evidence]
```

| Action | Reason | What it does | Case becomes |
| --- | --- | --- | --- |
| `review` | optional | Shows the pad's state and up to 64 KB of content, through any PIN. | `reviewing` (if `open`) |
| `capture` | optional | Seals the pad's document and text as [evidence](#evidence). Refused on removal requests. | `reviewing` (if `open`) |
| `freeze` | **required** | Pad stays readable; edits, PIN changes, and history restores are refused. Disconnects live sockets. | `actioned` |
| `unfreeze` | **required** | Lifts a freeze. | unchanged |
| `disconnect` | **required** | Closes live connections; access unchanged. | unchanged |
| `block` | **required** | Pad refuses all access and shows the removed notice with the case category. | `actioned` |
| `unblock` | **required** | Lifts a block. | unchanged |
| `purge` | **required** | Wipes content, history, PIN, sessions, and read-only link. `--block` also blocks the address. On a `violation` without evidence, refused unless `--without-evidence`. | `actioned` |
| `remove` | **required** | `capture`, then `purge --block`, stopping at the first failure. Violations only. | `actioned` |
| `dismiss` | **required** | Closes the case as not a violation; the reason becomes the decision. Starts retention. | `dismissed` |
| `close` | **required** | Closes the case; the reason becomes the decision. Starts retention. | `closed` |

| Flag | Notes |
| --- | --- |
| `--reason` | Up to 500 characters. Private: never shown to visitors. |
| `--legal-basis` | Up to 500 characters. Stored on the case (the latest one wins). |
| `--block` | `purge` only: also block the address. |
| `--without-evidence` | `purge` only: purge a violation with no evidence, on purpose. Recorded. |

Each action that touches the pad records two log lines — the **intent** (before)
and the **outcome** (after). `remove` records four.

Refusals you may see: `reason-required`, `case-closed`, `capture-not-allowed`,
`remove-not-allowed`, `evidence-required`, `room-failed` (the pad didn't
confirm — run it again, or [`reconcile`](#reconcile)).

## Evidence

### `evidence <id>`

Show an evidence record: case, pad, capture time, sizes, fingerprints, retention,
and hold.

### `evidence <id> download`

```sh
node scripts/admin.mjs <host> evidence <id> download [--out <dir>]
```

Logs the download, fetches the document and text, **re-computes both SHA-256
fingerprints, and writes nothing if either differs**. Writes to `--out` (default:
current folder):

- `<slug>-evidence-<id>.yjs` — the stored document, byte for byte
- `<slug>-evidence-<id>.txt` — its text
- `<slug>-evidence-<id>.manifest.json` — the record, host, and download time

Refused with `evidence-expired` once retention has deleted it.

### `evidence <id> hold` / `release`

```sh
node scripts/admin.mjs <host> evidence <id> hold --reason "…"
node scripts/admin.mjs <host> evidence <id> release --reason "…"
```

Held evidence is never deleted by retention. Both need a reason and are logged.

## Pads

### `pad <slug> info`

Review a pad that has no case yet — state and up to 64 KB of content. Recorded as
a review with no case.

```sh
node scripts/admin.mjs <host> pad <slug> info
```

## Bulk

### `bulk`

Run one case action over many pads.

```sh
node scripts/admin.mjs <host> bulk <file> <action> --category <id> [--reason "…"] \
  [--kind violation] [--source other] [--legal-basis "…"] [--block] [--without-evidence] [--apply]
```

- **`<file>`** — one slug, `/slug`, or pad URL per line; blank lines and `#`
  comments are ignored.
- **`<action>`** — any case action except `open`: `review`, `capture`, `freeze`,
  `unfreeze`, `disconnect`, `block`, `unblock`, `purge`, `remove`, `dismiss`,
  `close`.
- **`--category`** is required (it files each pad's case); **`--reason`** is
  required for everything except `review` and `capture`.
- **Without `--apply` it's a dry run**: it only looks up existing cases and prints
  what would happen. Invalid addresses are flagged.
- **With `--apply`**, for each pad: open or join its case (`--source`, default
  `other`, note "bulk \<action\> from \<file\>"), then act.

Output: one line per pad (case, outcome, pad), then a summary. Exits `1` if any
pad failed or was invalid.

## Totals and exports

### `stats`

```sh
node scripts/admin.mjs <host> stats [--from YYYY-MM-DD] [--to YYYY-MM-DD]
```

Totals for the window: notices by category and source; cases by status,
priority, and kind; actions done and failed; evidence captured, expired, and on
hold now; and, per priority, time to first review and to action (count, median,
p90, share within the profile's target).

Windows are in UTC. `--from` is inclusive; a date-only `--to` includes that whole
day. Cases count by opening time, notices by arrival, actions by when they
happened.

### `export`

```sh
node scripts/admin.mjs <host> export reports|cases|actions|evidence \
  [--format json|csv] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--include-contact]
```

Writes to stdout; redirect to a file. Every export is logged before it's sent.

- `json` (default) is exact — use it for `verify-chain --file`.
- `csv` is spreadsheet-safe: cells starting with `=`, `+`, `-`, `@`, tab, or
  carriage return get a leading `'`.
- Reporter contact appears only with `--include-contact`.
- `evidence` exports records (sizes, fingerprints, retention), not content.

## Integrity

### `reconcile`

Resolve actions that recorded an intent but no outcome (an interruption between
the ledger and the pad). For each, it reads the pad's current state and records
`ok` if the action took effect, `failed` if not. Reviews, captures, and
disconnects can't be observed afterwards and resolve as `failed`.

### `verify-chain`

```sh
node scripts/admin.mjs <host> verify-chain
node scripts/admin.mjs verify-chain --file <actions-export.json>
```

Checks that every action-log entry still matches its fingerprint and links to the
one before it. The `--file` form works offline on a JSON `export actions`, with no
host or secret; a partial export is checked from its first entry.

Each fingerprint is the SHA-256 of the JSON array
`[seq, at, caseId, slug, action, reason, paramsJson, outcome, prevHash]`.

## Values

### Categories

From the moderation profile (`src/lib/moderation-profile.ts`). These are
`padline.page`'s values; a fork may change which are grave.

| Id | Shown to visitors as | Grave |
| --- | --- | --- |
| `child-sexual-exploitation` | Child sexual exploitation | yes |
| `terrorism` | Terrorism | yes |
| `violence-incitement` | Incitement to violence or self-harm | yes |
| `human-trafficking` | Human trafficking | yes |
| `anti-democratic` | Attacks on democratic institutions | yes |
| `phishing-malware` | Phishing or malware | no |
| `harassment-doxxing` | Harassment or doxxing | no |
| `copyright` | Copyright infringement | no |
| `defamation` | Defamation | no |
| `privacy` | Privacy violation | no |
| `spam` | Spam or platform abuse | no |
| `other` | Other Content Policy violation | no |

### Kinds

| Kind | Meaning |
| --- | --- |
| `violation` | The pad breaks the Content Policy or the law. |
| `removal-request` | Someone asks to delete their own content. No evidence is kept. |
| `appeal` | Someone contests a removal. |
| `authority-request` | An authority's request or order. Not available on the public form. |

### Sources

`form` (the `/report` form only), `email`, `cloudflare`, `authority`, `other`.

### Statuses

`open` → `reviewing` (after a review or capture) → `actioned` (after a freeze,
block, purge, or remove) → `closed` or `dismissed`.
