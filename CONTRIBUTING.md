# Contributing to Padline

Padline is intentionally small and sharply scoped. This guide covers setup, conventions and how to land a change.

## Getting set up

Use Node.js 24 LTS and npm (`.nvmrc` selects Node 24).

```sh
git clone https://github.com/idcesares/padline.git
cd padline
npm install
npm run dev      # http://127.0.0.1:8788
```

Everything runs locally: the Worker, the Durable Objects and their SQLite storage are emulated by `wrangler` through the Vite plugin. No Cloudflare account is needed until you deploy.

## Read first

- [`CONTEXT.md`](CONTEXT.md): the domain model and vocabulary (**pad**, **slug**, **room**, **identity**, **presence**, **report**, **block**). Use these words in code, comments and PRs.
- [`docs/adr/`](docs/adr/): one ADR per non-obvious decision. If your change contradicts one, either fit inside it or propose a new ADR that supersedes it.
- [`docs/design/mockup.html`](docs/design/mockup.html): the approved design. Match it; do not redesign.

The product invariants in `CONTEXT.md` (URL-first, no friction, public by design, real-time by default, local resilience, not trapped, bounded blast radius) are non-negotiable.

## Making a change

1. **Branch** off `main`: `git checkout -b feat/your-thing` (or `fix/`, `docs/`, `chore/`).
2. **Code.** Keep the style of the surrounding code. TypeScript is `strict`.
3. **Verify:**
   ```sh
   npm test          # slug unit tests and Workers-runtime integration tests
   npm run build     # typecheck and build must pass
   ```
   Room behavior belongs under `test/`; those tests run against the real Workers runtime, Durable Object storage and WebSocket implementation. There is no browser test suite yet, so check UI changes against the mockup by eye.
4. **Document.** A non-obvious decision gets an ADR (next number, same format). A new domain term goes in `CONTEXT.md`. Changed behavior, endpoint, setting or limit updates the page that describes it (see the table in [`docs/README.md`](docs/README.md)).
5. **Open a PR** that says what and why. Commits follow `type: summary` (`feat:`, `fix:`, `docs:`, `chore:`).

## What makes a good contribution

- **Small and focused.** One concern per PR.
- **Server-enforced.** Limits and blocks are enforced in the room, never only in the UI.
- **Free-tier friendly.** Changes should not require paid Cloudflare features.
- **Deferred scope stays deferred.** Accounts, uploads, comments and history are out of v1. Open an issue before building them.

## Bugs and features

Open a GitHub issue with steps to reproduce (bugs) or the problem you want solved (features). For security vulnerabilities, **do not open a public issue**: see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
