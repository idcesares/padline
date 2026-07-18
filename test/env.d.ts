declare namespace Cloudflare {
  interface Env {
    PadRoom: DurableObjectNamespace<import("../worker").PadRoom>;
    ASSETS: Fetcher;
  }
}
