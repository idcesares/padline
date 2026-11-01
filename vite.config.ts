import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [cloudflare()],
  server: {
    // Windows reserves 5142-5241 (WinNAT), which swallows Vite's default 5173.
    port: 8788,
    host: "127.0.0.1",
    // Durable Object writes are runtime output, not source changes. Watching
    // them reloads the page while a room test runs.
    watch: {
      ignored: ["**/.wrangler/**", "**/test-results/**"],
    },
  },
});
