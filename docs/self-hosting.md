# Self-hosting

Run Padline locally, deploy your own instance on Cloudflare, and keep it
healthy. Padline is one Cloudflare Worker and runs on the free tier.

> **Before you open an instance to the public**, read
> [Operating a public instance](operating-a-public-instance.md). Whoever deploys
> it is responsible for what it hosts, and this repository's policies and
> moderation values were written for one operator under Brazilian law.

- [What you need](#what-you-need)
- [Run it locally](#run-it-locally)
- [Deploy](#deploy)
- [Make it yours](#make-it-yours)
- [Turn on moderation and reporting](#turn-on-moderation-and-reporting)
- [Protect it at the edge](#protect-it-at-the-edge)
- [Verify a deployment](#verify-a-deployment)
- [Upgrade](#upgrade)
- [Troubleshooting](#troubleshooting)

## What you need

- **Node.js 22 or newer** and npm.
- **A Cloudflare account** (free) — only when you deploy. Local development needs
  no account.
- **A domain on Cloudflare** if you want a custom address; otherwise you get a
  `*.workers.dev` URL.

## Run it locally

```sh
git clone https://github.com/idcesares/padline.git
cd padline
npm install
npx playwright install chromium   # only for the browser tests
```

Create `.dev.vars` in the project root (it's gitignored) with local secrets:

```ini
ADMIN_SECRET=any-long-random-value-for-local-use
# Turnstile's public test keys: the report form works and always passes.
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

Start it:

```sh
npm run dev        # http://127.0.0.1:8788
```

Open `http://127.0.0.1:8788/my-first-pad` in two tabs and type in one. The
Worker, the Durable Objects, and their SQLite storage all run locally through
Wrangler.

To check everything works end to end, keep the dev server running and in
another terminal run the smoke suite:

```sh
node scripts/api-smoke.mjs         # every check must pass
```

For the full verification a change needs before merging, see
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Deploy

```sh
npx wrangler login     # once
npm run deploy         # build, then deploy the Worker, assets, and Durable Objects
```

`npm run deploy` applies Durable Object migrations automatically — the pad
rooms (`v1`) and the moderation ledger (`v2`). Your instance is live at
`https://padline.<your-subdomain>.workers.dev`.

**Before your first deploy from a fork**, edit the `routes` block in
[`wrangler.jsonc`](../wrangler.jsonc): it lists `padline.page` and its old
domains. Replace them with your own domain, or remove the block to use
`workers.dev`. Leave the rest of `wrangler.jsonc` alone — its asset routing is
deliberate (see the comments in the file and ADR-0011).

## Make it yours

A fork that deploys unchanged still says it's `padline.page`. Change:

| What | Where |
| --- | --- |
| Custom domains | `routes` in `wrangler.jsonc` |
| Canonical host and redirects | `CANONICAL_HOST` and `LEGACY_HOSTS` in `worker/index.ts` |
| Terms, Privacy Policy, Content Policy | `src/routes/legal.tsx` — rewrite for your instance and jurisdiction |
| Operator contact, report categories, review targets, retention | `src/lib/moderation-profile.ts` — see [Configuration](reference/configuration.md#moderation-profile) |
| Category names shown to visitors | `src/lib/moderation-labels.ts` |
| Crawler and AI-assistant policy, sitemap | `public/robots.txt`, `public/sitemap.xml`, `public/llms.txt` |
| Source link and author in footers | `src/routes/legal.tsx`, `src/routes/landing.tsx` |

## Turn on moderation and reporting

Three secrets switch on the operator tools and the public report form. Until
they're set, the moderation API answers like it doesn't exist, and reports are
refused with `503`.

1. **Create a Turnstile widget** in the Cloudflare dashboard (Turnstile → Add
   widget) for your domain. Keep its **site key** and **secret key**.
2. **Set the secrets:**

   ```sh
   npx wrangler secret put ADMIN_SECRET        # a long random value; keep it in a password manager
   npx wrangler secret put TURNSTILE_SECRET    # the widget's secret key
   npx wrangler secret put TURNSTILE_SITE_KEY  # the widget's site key (public)
   ```

3. **Deploy** (`npm run deploy`) if you haven't since setting them.
4. **Put the same `ADMIN_SECRET` in your local `.dev.vars`** (or export it) so the
   moderation CLI can reach the deployed instance.

Never deploy Turnstile's test keys (`1x0000…`). The smoke suite fails a remote
host that uses them.

Then read the [moderation guide](moderation-guide.md).

## Protect it at the edge

Padline enforces its own limits inside each pad, but a few Cloudflare
rate-limiting rules (Security → WAF → Rate limiting rules) are a cheap outer
layer:

| Rule | Why |
| --- | --- |
| Per-IP limit on requests to `/api/reports` | Slows report floods; Turnstile already runs before anything is stored. |
| Per-IP limit on `/parties/*` requests containing `op=verify-pin` | Outer layer against PIN guessing; each pad already backs off on its own. |
| Per-IP limit on new pad paths | Slows mass pad creation. |

## Verify a deployment

Run the smoke suite against your host. It reads `ADMIN_SECRET` from the
environment or `.dev.vars`:

```sh
node scripts/api-smoke.mjs https://your-domain
```

It checks pads, PINs, read-only links, security headers, the report channel, and
a full takedown lifecycle through the moderation ledger. Every check must pass.

What a production run leaves behind: one **closed** moderation case (category
`other`, "api-smoke takedown lifecycle"), a small sealed evidence record, and a
handful of action-log entries. They're labelled so you can recognize them in
[totals and exports](moderation-guide.md#see-the-whole-picture).

`--no-admin` skips the takedown lifecycle on purpose; treat that run as partial.

## Upgrade

```sh
git pull
npm install
npm test && npm run build
npm run deploy
node scripts/api-smoke.mjs https://your-domain
```

Read new ADRs in `docs/adr/` and the PR descriptions before upgrading — some
changes need a new secret or a dashboard rule.

## Troubleshooting

**The dev server isn't on port 8788, or 8788 returns strange 500s.** A previous
dev server is still holding the port. Stop leftover `node`/`workerd` processes and
start again. The port is pinned to `127.0.0.1:8788` because Windows reserves
ports 5142–5241 — don't change it back.

**`npm install` fails on peer dependencies.** `.npmrc` sets `legacy-peer-deps`;
make sure you're installing from the project root.

**`npm run build` fails with `EPERM` on `dist\padline\.wrangler` (Windows).** A
`workerd` process from an earlier test run is locking it. Stop `workerd`
processes, delete `dist`, and build again.

**The browser tests fail immediately.** `npm run test:e2e` starts its own server
on 8788 — stop `npm run dev` first. The first run on a cold cache can miss the
pad-open time budget; run it again before treating it as a regression.

**The report form says reporting isn't available.** `TURNSTILE_SITE_KEY` isn't set
on that instance (locally: `.dev.vars`).

**The moderation CLI says "Rejected as unknown-op".** The `ADMIN_SECRET` you're
using doesn't match the deployed one, the secret isn't deployed, or the instance
predates the moderation ledger.
