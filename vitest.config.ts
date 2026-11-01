import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
    },
    plugins: [
      cloudflareTest({
        wrangler: {
          configPath: "./wrangler.jsonc",
        },
        miniflare: {
          // wrangler.jsonc deliberately omits assets.directory (the Vite plugin
          // injects it at build time), so the real ASSETS binding does not exist
          // under the test pool. Stub it as an always-miss fetcher.
          serviceBindings: {
            ASSETS: () => new Response("Not found", { status: 404 }),
          },
          bindings: {
            TEST_MIGRATIONS: migrations,
            ACCESS_TEAM_DOMAIN: "team.test.cloudflareaccess.com",
            ACCESS_AUD: "test-aud",
          },
        },
      }),
    ],
  };
});
