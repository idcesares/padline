import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      miniflare: {
        bindings: {
          ADMIN_SECRET: "test-admin-secret",
        },
        // wrangler.jsonc deliberately omits assets.directory — the Vite plugin
        // injects it at build time — so the real ASSETS binding does not exist
        // under the test pool. Stub it as an always-miss fetcher: the miss
        // branch is the only /assets/* behavior this runtime can prove, and
        // serving a real hashed asset is covered by scripts/api-smoke.mjs.
        serviceBindings: {
          ASSETS: () => new Response("Not found", { status: 404 }),
        },
      },
    }),
  ],
});
