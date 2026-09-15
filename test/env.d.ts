declare namespace Cloudflare {
  interface Env {
    PadRoom: DurableObjectNamespace<import("../worker").PadRoom>;
    ModerationLedger: DurableObjectNamespace<import("../worker").ModerationLedger>;
    ASSETS: Fetcher;
  }
}
