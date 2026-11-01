declare namespace Cloudflare {
  interface Env {
    PadRoom: DurableObjectNamespace<import("../worker/pad-room").PadRoom>;
    ASSETS: Fetcher;
    DB: D1Database;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    ADMIN_DEV_BYPASS?: string;
    TEST_MIGRATIONS?: import("cloudflare:test").D1Migration[];
  }
}
