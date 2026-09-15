import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      miniflare: {
        bindings: {
          ADMIN_SECRET: "test-admin-secret",
          // Turnstile's documented always-pass test secret (ADR-0018).
          TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
        },
        // Answers Turnstile siteverify the way Cloudflare does for its test
        // keys, so report intake runs without network access and without a
        // test hook in the Worker: the dummy token passes a 1x secret, and
        // anything else fails. No other outbound request is expected.
        outboundService: async (request) => {
          if (new URL(request.url).hostname !== "challenges.cloudflare.com") {
            return new Response("unexpected outbound request in tests", {
              status: 502,
            });
          }
          const { secret, response } = (await request.json()) as {
            secret?: string;
            response?: string;
          };
          const success =
            secret?.startsWith("1x") === true &&
            response === "XXXX.DUMMY.TOKEN.XXXX";
          return Response.json({
            success,
            "error-codes": success ? [] : ["invalid-input-response"],
          });
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
