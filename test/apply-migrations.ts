import { applyD1Migrations, env } from "cloudflare:test";

// Runs before every test file. Applying is idempotent.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS ?? []);
