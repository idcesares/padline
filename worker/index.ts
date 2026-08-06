import { Hono } from "hono";
import {
  routePartykitRequest,
  type Connection,
  type ConnectionContext,
} from "partyserver";
import { YServer } from "y-partyserver";
import * as Y from "yjs";
import { isValidSlug } from "../src/lib/slug";
import {
  CLOSE_PAD_REMOVED,
  DOC_OVER_CAP_KEY,
  RoomCapabilities,
  type BlockRecord,
  type RoomRuntimeState,
} from "./room-capabilities";
import { RoomSecurity, safeEqual } from "./room-security";

type Env = {
  PadRoom: DurableObjectNamespace<PadRoom>;
  ASSETS: Fetcher;
  /** Bearer secret for op=admin-*; unset disables the admin surface entirely. */
  ADMIN_SECRET?: string;
};

// ADR-0008: cheap-to-enforce, catastrophic-to-miss invariants.
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 256 * 1024;
const MAX_CONNECTIONS = 50;
const MAX_CONNECTIONS_PER_IP = 8;

// ADR-0006: snapshot cadence and retention.
const SNAPSHOT_MIN_INTERVAL_MS = 60_000;
const SNAPSHOT_KEEP = 100;

type ConnState = { readonly: boolean; ip: string } | null;

/**
 * One pad ↔ one room (ADR-0003). Holds live connections, the Yjs doc,
 * snapshot history, and the PIN/read-only gates (ADR-0005/0006/0008).
 */
export class PadRoom extends YServer<Env> {
  static callbackOptions = {
    debounceWait: 2000,
    debounceMaxWait: 10000,
  };

  private readonly runtime: RoomRuntimeState = { docOverCap: false };
  private readonly security = new RoomSecurity(this.ctx.storage, this.env);
  private readonly capabilities = new RoomCapabilities({
    storage: this.ctx.storage,
    security: this.security,
    roomName: this.name,
    document: this.document,
    runtime: this.runtime,
    connections: () => this.getConnections(),
    replaceDocument: (data) =>
      this.unstable_replaceDocument(data, (key) =>
        key === "document" ? "XmlFragment" : "Map",
      ),
  });

  async onLoad() {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        size INTEGER NOT NULL,
        data BLOB NOT NULL
      )`,
    );
    const [stored, storedOverCap] = await Promise.all([
      this.ctx.storage.get<Uint8Array>("doc"),
      this.ctx.storage.get<boolean>(DOC_OVER_CAP_KEY),
    ]);
    this.runtime.docOverCap =
      storedOverCap === true || (stored?.byteLength ?? 0) > MAX_DOC_BYTES;
    if (stored) {
      Y.applyUpdate(this.document, stored);
    }
  }

  async onSave() {
    const update = Y.encodeStateAsUpdate(this.document);
    // Empty docs stay unpersisted so typos/crawlers mint nothing (ADR-0004).
    if (update.byteLength <= 2) return;
    this.runtime.docOverCap = update.byteLength > MAX_DOC_BYTES;
    if (this.runtime.docOverCap) {
      await this.ctx.storage.put(DOC_OVER_CAP_KEY, true);
      return;
    }
    await this.ctx.storage.delete(DOC_OVER_CAP_KEY);
    await this.ctx.storage.put("doc", update);
    await this.maybeSnapshot(update);
  }

  private async maybeSnapshot(update: Uint8Array) {
    const last = (await this.ctx.storage.get<number>("lastSnapshotAt")) ?? 0;
    const now = Date.now();
    if (now - last < SNAPSHOT_MIN_INTERVAL_MS) return;
    this.ctx.storage.sql.exec(
      "INSERT INTO snapshots (created_at, size, data) VALUES (?, ?, ?)",
      now,
      update.byteLength,
      update.buffer.slice(update.byteOffset, update.byteOffset + update.byteLength),
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM snapshots WHERE id NOT IN
        (SELECT id FROM snapshots ORDER BY id DESC LIMIT ${SNAPSHOT_KEEP})`,
    );
    await this.ctx.storage.put("lastSnapshotAt", now);
  }

  // --- connection gating (ADR-0005: no doc bytes before auth) ---

  async onConnect(conn: Connection, ctx: ConnectionContext) {
    if (!isValidSlug(this.name)) {
      conn.close(4400, "invalid-slug");
      return;
    }
    // ADR-0010: takedown outranks every capability, including PIN sessions
    // and read-only links.
    if (await this.ctx.storage.get<BlockRecord>("blocked")) {
      conn.close(CLOSE_PAD_REMOVED, "pad-removed");
      return;
    }
    const connections = [...this.getConnections()];
    // partyserver has already registered `conn` at this point, so the
    // connecting socket is included in the count.
    if (connections.length > MAX_CONNECTIONS) {
      conn.close(1013, "pad-full");
      return;
    }
    // ADR-0008: per-IP cap (header absent in local dev — skipped there).
    const ip = ctx.request.headers.get("cf-connecting-ip") ?? "";
    if (ip) {
      const sameIp = connections.filter(
        (c) => c !== conn && (c.state as ConnState)?.ip === ip,
      ).length;
      if (sameIp >= MAX_CONNECTIONS_PER_IP) {
        conn.close(1013, "too-many-connections");
        return;
      }
    }
    const url = new URL(ctx.request.url);
    const ro = url.searchParams.get("ro");
    if (ro) {
      const roToken = await this.ctx.storage.get<string>("roToken");
      if (!roToken || !safeEqual(ro, roToken)) {
        conn.close(4403, "invalid-token");
        return;
      }
      conn.setState({ readonly: true, ip });
    } else {
      if (!(await this.security.canEdit(url.searchParams.get("token")))) {
        conn.close(4401, "pin-required");
        return;
      }
      conn.setState({ readonly: false, ip });
    }
    super.onConnect(conn, ctx);
  }

  /** Unauthorized (state not yet set) fails closed; read-only links can't write. */
  isReadOnly(conn: Connection): boolean {
    const state = conn.state as ConnState;
    if (state?.readonly !== false) return true;
    return this.runtime.docOverCap;
  }

  onMessage(conn: Connection, message: string | ArrayBuffer | ArrayBufferView) {
    const size =
      typeof message === "string"
        ? new TextEncoder().encode(message).byteLength
        : message.byteLength;
    if (size > MAX_MESSAGE_BYTES) {
      conn.close(1009, "message-too-large");
      return;
    }
    // Drop anything sent before onConnect finished authorizing.
    if ((conn.state as ConnState) == null) return;
    super.onMessage(conn, message);
  }

  async onRequest(request: Request): Promise<Response> {
    return this.capabilities.handle(request);
  }
}

// --- Worker: parties routing, API, OG tags for crawlers, asset serving ---

const CANONICAL_HOST = "padline.page";
const LEGACY_HOSTS = new Set(["www.padline.page", "padline.dcesares.dev"]);

const CRAWLER_RE =
  /facebookexternalhit|twitterbot|slackbot|discordbot|linkedinbot|whatsapp|telegrambot|googlebot|bingbot/i;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function ogResponse(slug: string, origin: string): Response {
  const title = escapeHtml(`/${slug} — Padline`);
  const description =
    "A real-time collaborative pad. Open the link to read or edit together.";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="robots" content="noindex">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:url" content="${origin}/${slug}">
<meta name="twitter:card" content="summary">
</head>
<body><p>${title}</p></body>
</html>`;
  return new Response(html, {
    headers: { "content-type": "text/html;charset=utf-8" },
  });
}

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

// ADR-0009: defense-in-depth headers on every HTML/asset response.
function csp(hostname: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Explicit wss entry: not every browser maps same-origin ws under 'self'.
    `connect-src 'self' wss://${hostname}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    // form-action does NOT fall back to default-src, so without this entry
    // submission targets stay unrestricted however tight the rest is. Padline
    // posts everything over fetch/websocket and has no <form> action at all.
    "form-action 'none'",
  ].join("; ");
}

// One year. No `preload`: preloading is effectively irreversible once the list
// ships, whereas a max-age can be wound down. includeSubDomains is safe here
// because every padline.page host is a Cloudflare HTTPS custom domain — adding
// an HTTP-only subdomain later would require revisiting this.
const HSTS = "max-age=31536000; includeSubDomains";

function withSecurityHeaders(response: Response, hostname: string): Response {
  const res = new Response(response.body, response);
  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("referrer-policy", "no-referrer");
  // Vite dev injects inline scripts (react-refresh); CSP is prod-only.
  // HSTS is likewise skipped so a year of forced HTTPS is never pinned
  // against localhost, where browsers would honor it on any local port.
  const isDev = hostname === "localhost" || hostname === "127.0.0.1";
  if (!isDev) {
    res.headers.set("content-security-policy", csp(hostname));
    res.headers.set("strict-transport-security", HSTS);
  }
  return res;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Canonical host: www and the legacy domain permanently redirect to
    // padline.page so pad links resolve to a single origin.
    const requestUrl = new URL(request.url);
    if (LEGACY_HOSTS.has(requestUrl.hostname)) {
      requestUrl.hostname = CANONICAL_HOST;
      return Response.redirect(requestUrl.toString(), 301);
    }

    const roomResponse = await routePartykitRequest(request, env as never);
    if (roomResponse) return roomResponse;

    const url = new URL(request.url);
    // Hashed assets: serve the real file, answer a miss with a 404 that is
    // explicitly not cacheable, and never fall back to the SPA shell — HTML
    // cached as JavaScript under the immutable /assets/* rule in
    // public/_headers breaks clients after a deployment (ADR-0011).
    //
    // Dormant under the current routing: `!/assets/*` in run_worker_first
    // means these requests are answered by the asset router and never reach
    // the Worker. It is written to be correct if that exclusion is ever
    // dropped — hence serving the asset rather than 404ing unconditionally,
    // which would blank every chunk the moment the Worker saw one.
    if (url.pathname.startsWith("/assets/")) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status === 404) {
        return withSecurityHeaders(
          new Response("Not found", {
            status: 404,
            headers: {
              "content-type": "text/plain;charset=utf-8",
              "cache-control": "no-store",
            },
          }),
          url.hostname,
        );
      }
      return withSecurityHeaders(asset, url.hostname);
    }
    if (url.pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }

    const slug = url.pathname.slice(1);
    if (
      isValidSlug(slug) &&
      CRAWLER_RE.test(request.headers.get("user-agent") ?? "")
    ) {
      return withSecurityHeaders(ogResponse(slug, url.origin), url.hostname);
    }

    // not_found_handling is "none", so the asset router no longer invents an
    // index.html for unmatched paths. Real files (/, /robots.txt, ...) still
    // serve directly; a pad path is a client-side route and must still boot
    // the SPA, so the shell is served explicitly here.
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) {
      return withSecurityHeaders(asset, url.hostname);
    }
    const shell = await env.ASSETS.fetch(new URL("/index.html", url.origin));
    return withSecurityHeaders(shell, url.hostname);
  },
} satisfies ExportedHandler<Env>;
