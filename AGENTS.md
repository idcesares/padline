# AGENTS.md

Instructions for AI coding agents working in this repository: Claude Code,
Codex, Cursor, Copilot, and any other tool that reads [agents.md](https://agents.md).

## Start here

- [`CONTEXT.md`](CONTEXT.md): domain model and ubiquitous language. Use these
  terms (pad, slug, room, identity, presence, report, block) in code, comments,
  commits and PRs.
- [`docs/adr/`](docs/adr/): every non-obvious decision has a numbered ADR:
  product (0001), moderation (0002), lifecycle and limits (0003), delivery and
  tests (0004).
- [`docs/design/mockup.html`](docs/design/mockup.html): the approved design spec.
  Open it in a browser. Match it; do not redesign.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): setup and PR conventions.

## Agent-specific conventions

### Issue tracker

Issues and specs are local markdown files under `.scratch/<feature>/`, not
GitHub Issues. See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Domain docs

Single-context layout: one `CONTEXT.md` and `docs/adr/` at the repo root.
See [`docs/agents/domain.md`](docs/agents/domain.md).

## Keep the docs true

When a change touches behavior, update the doc that covers it
([`docs/README.md`](docs/README.md) maps code to docs), or flag it as stale in
the PR. Do not leave a doc that contradicts the code without saying so. A
non-obvious decision gets an ADR.

## Moderation invariants (ADR-0002)

Do not break these without a superseding ADR:

- The room is the enforcement authority for a block. The pad index and the
  admin page never decide on their own whether a pad is blocked.
- `actions` rows are never updated or deleted.
- Pad content never enters `pads`, `reports` or `actions`: sizes, slugs,
  categories and dates only. No evidence copies.
- A public report's response never reveals whether a pad exists, and no IP
  address is stored.
- The operator's reason never appears in a public response; only the category
  and date do.
- The admin surface sits behind Cloudflare Access; there is no public path to
  it.
- No cases, evidence retention, exports, bulk actions, or categories beyond the
  short fixed list.

## Verify before calling a change done

```sh
npm test          # slug unit tests and Workers-runtime integration tests
npm run build     # typecheck and build
```

There is no browser test suite yet. Say so rather than implying coverage, and
check UI changes against `docs/design/mockup.html` by eye.

## Known machine quirks (Windows dev)

- Windows reserves TCP ports 5142 to 5241; the dev server is pinned to
  `127.0.0.1:8788` in `vite.config.ts` for this reason. Do not "fix" the port
  back to a default.
- `npm install` needs `--legacy-peer-deps` (already set in `.npmrc`) because
  `y-partyserver` peers `workers-types` v4 against wrangler's v5.
- `vite build` and `vitest` can leave orphaned `workerd.exe` processes that lock
  `dist\padline\.wrangler`, breaking the next build with `EPERM`. Fix: stop any
  `workerd` processes and remove `dist` before rebuilding.
- A stopped dev server can keep holding port 8788, so Vite moves to 8789 and the
  stale port returns fake 500s. Check the port before trusting a result.
