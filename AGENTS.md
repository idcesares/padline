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

## Verify before calling a change done

```sh
npm test                      # Workers-runtime integration tests
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
