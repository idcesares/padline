# Self-hosting

Run Padline locally, deploy your own instance on Cloudflare, and keep it healthy. Padline is one Cloudflare Worker and runs on the free tier.

Whoever deploys an instance is responsible for what it hosts. Pads are public and anyone can write to them, so decide how you will handle abuse before you open it to the public ([ADR-0002](adr/0002-lean-moderation.md)).

## What you need

- **Node.js 24 LTS** and npm (`.nvmrc` selects Node 24).
- **A Cloudflare account** (free), only when you deploy.
- **A domain on Cloudflare** for a custom address; otherwise you get a `*.workers.dev` URL.

## Run it locally

```sh
git clone https://github.com/idcesares/padline.git
cd padline
npm install
npm run dev        # http://127.0.0.1:8788
```

Open `http://127.0.0.1:8788/my-first-pad` in two tabs and type in one. The Worker, the Durable Objects and their SQLite storage all run locally through Wrangler. No secrets are needed.

To try the admin page locally, create the local database and open the bypass (localhost only):

```sh
npm run db:migrate:local
echo ADMIN_DEV_BYPASS=1 >> .dev.vars
```

Then open `http://127.0.0.1:8788/admin`.

Before you call a change done:

```sh
npm test
npm run build
```

### Windows notes

- Windows reserves TCP ports 5142 to 5241. The dev server is pinned to `127.0.0.1:8788` in `vite.config.ts` for this reason; do not change it back to a default.
- `npm install` needs `--legacy-peer-deps` (already set in `.npmrc`) because `y-partyserver` peers `workers-types` v4 against Wrangler's v5.
- `vite build` and `vitest` can leave orphaned `workerd.exe` processes that lock `dist\padline\.wrangler` and break the next build with `EPERM`. Stop any `workerd` processes and remove `dist` before rebuilding.
- A stopped dev server can keep holding port 8788; Vite then moves to 8789 and the stale port returns fake 500s. Check the port before trusting a result.

## Deploy

```sh
npx wrangler login     # once
npm run deploy         # build, then deploy the Worker, assets and Durable Objects
```

`npm run deploy` applies the Durable Object migrations automatically. Your instance is live at `https://padline.<your-subdomain>.workers.dev`.

Before your first deploy from a fork, edit the `routes` block in [`wrangler.jsonc`](../wrangler.jsonc): it lists `padline.page` and its aliases. Replace them with your own domain, or remove the block to use `workers.dev`. Leave the asset settings alone; they are deliberate ([ADR-0004](adr/0004-cloudflare-native-delivery-and-tests.md)).

## Moderation setup

The admin page and report inbox need a D1 database and Cloudflare Access ([ADR-0002](adr/0002-lean-moderation.md)). Do this before you open the instance to the public:

1. Create the database and apply the schema:
   ```sh
   npx wrangler d1 create padline
   npx wrangler d1 migrations apply padline --remote
   ```
   Paste the returned `database_id` into the `d1_databases` entry in `wrangler.jsonc`.
2. In Cloudflare Zero Trust, create a self-hosted Access application covering `/admin` and `/api/admin/*` on your domain, with a policy that allows only you.
3. Put the team domain and the application's AUD tag in `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.jsonc`, then deploy. Until both are set, the admin page answers `403`.
4. Check that `workers_dev` is off or also covered by Access, so there is no unprotected `*.workers.dev` path to `/admin`.
5. Add a rate limiting rule on `/api/report` at the edge (see below).

## Make it yours

A fork that deploys unchanged still says it is `padline.page`. Change:

| What | Where |
| --- | --- |
| Custom domains | `routes` in `wrangler.jsonc` |
| Canonical host and redirects | `CANONICAL_HOST` and `ALIAS_HOSTS` in `worker/index.ts` |
| Reserved words | the reserved list in `shared/slug.ts` |
| Limits | `shared/limits.ts` |
| Crawler and AI-assistant policy, sitemap | `public/robots.txt`, `public/sitemap.xml`, `public/llms.txt` |
| Names, links and contact | `index.html`, `public/humans.txt`, `package.json`, `SECURITY.md` |

## Protect it at the edge

Rate limiting is a Cloudflare rule, not application code ([ADR-0003](adr/0003-pad-lifecycle-and-limits.md)). In the Cloudflare dashboard, add a rate limiting rule on your zone for the WebSocket path (`/parties/*`), for `/api/report` and for page loads, sized for your traffic. The room already caps document size, connections per pad and message size.

## Verify a deployment

```sh
curl -s https://your-domain/api/health
# {"ok":true}
```

Then open `https://your-domain/test-pad` in two browsers, type in one, and confirm the other updates and the status pill reads "saved".

## Upgrade

Pull, then `npm install`, `npm test`, `npm run build`, `npm run deploy`. Read any new ADRs first; Durable Object migrations in `wrangler.jsonc` are append-only, so never edit or reorder an applied entry.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Pads never connect | A Cloudflare rule or proxy is blocking WebSockets on `/parties/*`. |
| `EPERM` on build | Orphaned `workerd` process; see [Windows notes](#windows-notes). |
| A stale page after deploy | Hard-reload; hashed assets change names on every build. |
| "This pad is busy" for everyone | The pad has more than about 50 connections; wait or use another address. |
