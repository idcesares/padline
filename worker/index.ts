import { Hono } from "hono";
import { routePartykitRequest } from "partyserver";
import { YServer } from "y-partyserver";
import * as Y from "yjs";

type Env = {
  PadRoom: DurableObjectNamespace;
  ASSETS: Fetcher;
};

const MAX_DOC_BYTES = 2 * 1024 * 1024; // ADR-0008: ~2MB Yjs state cap

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set(["api", "assets", "parties", "p", "r", "admin"]);

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug);
}

/**
 * One pad ↔ one room (ADR-0003). The Yjs doc is persisted as a single
 * encoded update; the room is not persisted until the first edit (ADR-0004).
 */
export class PadRoom extends YServer<Env> {
  static callbackOptions = {
    debounceWait: 2000,
    debounceMaxWait: 10000,
  };

  async onLoad() {
    const stored = await this.ctx.storage.get<Uint8Array>("doc");
    if (stored) {
      Y.applyUpdate(this.document, stored);
    }
  }

  async onSave() {
    const update = Y.encodeStateAsUpdate(this.document);
    if (update.byteLength > MAX_DOC_BYTES) {
      // Past the cap we stop persisting growth; enforcement of incoming
      // updates lands with the abuse-invariants pass (ADR-0008).
      return;
    }
    // Empty docs stay unpersisted so typos/crawlers mint nothing (ADR-0004).
    if (update.byteLength <= 2) return;
    await this.ctx.storage.put("doc", update);
  }
}

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const roomResponse = await routePartykitRequest(request, env as never);
    if (roomResponse) return roomResponse;
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
