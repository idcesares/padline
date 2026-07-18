# Contributing to Padline

Thanks for your interest! Padline is intentionally small and sharply scoped — this guide tells you how to get set up, what the conventions are, and how to land a change.

## Getting set up

```sh
git clone https://github.com/idcesares/padline.git
cd padline
npm install
npm run dev      # http://127.0.0.1:8788
```

Everything runs locally — the Worker, the Durable Objects, and SQLite storage are all emulated by `wrangler` via the Vite plugin. No Cloudflare account is needed until you deploy.

## Before you code: read the docs

The repo is documentation-first. Two files tell you almost everything:

- [`CONTEXT.md`](CONTEXT.md) — the domain model and ubiquitous language (**pad**, **slug**, **room**, **snapshot**, **PIN**, **read-only link**, **identity**, **presence**). Use these words in code, comments, and PRs.
- [`docs/adr/`](docs/adr/) — Architecture Decision Records. Every non-obvious choice has one. If your change contradicts an ADR, the PR should either fit inside it or propose a new ADR that supersedes it.

The product invariants in `CONTEXT.md` (URL-first, no friction, real-time by default, local resilience, not trapped, bounded blast radius) are non-negotiable — features that break them won't be merged.

## Making a change

1. **Branch** off `main`: `git checkout -b feat/your-thing` (or `fix/`, `docs/`, `chore/`).
2. **Code.** Keep the style of the surrounding code. TypeScript is `strict`; the build fails on unused locals/parameters.
3. **Verify**:
   ```sh
   npm test                      # Workers-runtime integration tests
   npm run build                 # typecheck + build must pass
   npm run dev                   # in one terminal
   node scripts/api-smoke.mjs    # in another — every check must pass
   ```
   If you changed a room invariant, add a focused test under `test/`; these run
   against the real Cloudflare Workers runtime, Durable Object storage, and
   WebSocket implementation. Add or update `scripts/api-smoke.mjs` when the
   behavior also needs verification against a running or deployed instance.
4. **Document.** New invariant or non-obvious decision → new ADR (copy the format of an existing one, numbered sequentially). New domain term → add it to `CONTEXT.md`.
5. **Open a PR** with a clear description of what and why. Commit messages follow the `type: summary` convention (`feat:`, `fix:`, `docs:`, `chore:`).

## What makes a good contribution

- **Small and focused** — one concern per PR.
- **Server-enforced** — anything security-relevant (auth, limits, read-only) must be enforced in the Durable Object, never only in the UI (see ADR-0005).
- **Free-tier friendly** — Padline runs on Cloudflare's free tier by design; changes shouldn't require paid features.
- **Cloudflare-native verification** — room behavior belongs in the Workers
  Vitest pool; use mocks only for code that never touches a runtime interface.
- **Deferred scope stays deferred** — images/attachments, accounts, comments, and AI features are explicitly phase 2+ (see `CONTEXT.md`). Open an issue to discuss before building these.

## Reporting bugs & proposing features

Open a GitHub issue with steps to reproduce (bugs) or the problem you're trying to solve (features). For security vulnerabilities, **do not open a public issue** — see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
