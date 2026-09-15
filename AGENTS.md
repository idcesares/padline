# AGENTS.md

Instructions for AI coding agents working in this repository — Claude Code,
Codex, Cursor, Copilot, and any other tool that reads [agents.md](https://agents.md).

## Start here

- [`CONTEXT.md`](CONTEXT.md) — domain model and ubiquitous language. Use these
  terms (pad, slug, room, snapshot, PIN, read-only link, identity, presence)
  in code, comments, commits, and PRs.
- [`docs/adr/`](docs/adr/) — every non-obvious architectural decision has a
  numbered ADR. A change that contradicts one should either fit inside it or
  add a new ADR that supersedes it.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — setup, verification steps, and PR
  conventions. Follow it exactly; it is not duplicated here.

## Agent-specific conventions

### Issue tracker

Issues and specs are local markdown files under `.scratch/<feature>/`, not
GitHub Issues. See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Domain docs

Single-context layout — one `CONTEXT.md` and `docs/adr/` at the repo root.
See [`docs/agents/domain.md`](docs/agents/domain.md).

## Documentation map

| When you need… | Read |
| --- | --- |
| Domain terms | [`CONTEXT.md`](CONTEXT.md) |
| Why something is built this way | [`docs/adr/`](docs/adr/) |
| Modules, flows, storage keys and tables, security boundaries | [`docs/architecture.md`](docs/architecture.md) |
| Every endpoint, op, status code, close code, and record shape | [`docs/reference/http-api.md`](docs/reference/http-api.md) |
| Every moderation CLI command and flag | [`docs/reference/cli.md`](docs/reference/cli.md) |
| Secrets, bindings, moderation profile, built-in limits | [`docs/reference/configuration.md`](docs/reference/configuration.md) |
| User-visible behavior | [`docs/user-guide.md`](docs/user-guide.md) |
| Operator workflows | [`docs/moderation-guide.md`](docs/moderation-guide.md), [`docs/self-hosting.md`](docs/self-hosting.md) |

## Keep the docs true

The docs are part of the change. When a change touches:

| This | Update |
| --- | --- |
| Something a visitor sees or a limit they hit | `docs/user-guide.md` and the limits table in `docs/reference/configuration.md` |
| An HTTP op, endpoint, request/response field, status, error code, or close code | `docs/reference/http-api.md` |
| A CLI command, flag, or its output | `docs/reference/cli.md`, and `docs/moderation-guide.md` if the workflow changes |
| A secret, binding, migration, or moderation-profile field | `docs/reference/configuration.md` and `docs/self-hosting.md` |
| A module boundary, storage key, table, or flow | `docs/architecture.md` |
| A non-obvious decision | A new ADR |

Write docs in plain language for humans first; keep exact names, values, and
codes in the reference pages rather than repeating them across guides.

## Moderation invariants (ADR-0018)

Do not break these without a superseding ADR:

- Room `admin-*` operations are reachable **only** from the moderation ledger. Never
  add a public path to them; `worker/index.ts` refuses them on `/parties`.
- Every review, room action, evidence download, export, and retention deletion
  appends to the action log. **Action rows are never updated or deleted.**
- Pad content never enters the action log — only sizes and SHA-256 hashes.
- The room is the enforcement authority; the ledger never decides on its own
  whether a pad is blocked or frozen.
- Jurisdiction-specific values live in `src/lib/moderation-profile.ts`, not in
  code. Category ids are stable once stored.
- A public report's response never reveals whether a pad exists; no IP address is
  stored.
- Reporter contact leaves the ledger only when explicitly requested
  (`includeContact`).
- The operator's `reason` never appears in a public response; only the category
  and date do.

## Verify before calling a change done

```sh
npm test                      # Workers-runtime integration tests
npm run test:e2e              # Browser pad-session characterization tests
npm run build                 # typecheck + build
npm run dev                   # in one terminal
node scripts/api-smoke.mjs    # in another — every check must pass
```

## Known machine quirks (Windows dev)

- Windows reserves TCP ports 5142–5241; the dev server is pinned to
  `127.0.0.1:8788` in `wrangler.jsonc` for this reason — don't "fix" the port
  back to a default.
- `npm install` needs `--legacy-peer-deps` (already set in `.npmrc`) because
  `partyserver` peers `workers-types` v4 against wrangler's v5.
- `vite build` / `vitest` can leave orphaned `workerd.exe` processes that lock
  `dist\padline\.wrangler`, breaking the next build with `EPERM`. Fix: stop
  any `workerd` processes and remove `dist` before rebuilding.
