import { Hono } from "hono";
import {
  routePartykitRequest,
  type Connection,
  type ConnectionContext,
} from "partyserver";
import { YServer } from "y-partyserver";
import * as Y from "yjs";
import { isValidSlug } from "../src/lib/slug";

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
const MAX_SESSIONS = 200;

// ADR-0009: PIN brute-force backoff and session lifetime.
const PIN_FREE_ATTEMPTS = 5;
const PIN_BACKOFF_MAX_MS = 60_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ADR-0006: snapshot cadence and retention.
const SNAPSHOT_MIN_INTERVAL_MS = 60_000;
const SNAPSHOT_KEEP = 100;
const DOC_OVER_CAP_KEY = "docOverCap";

type PinRecord = { salt: string; hash: string };
type PinFails = { count: number; lastAt: number };
type ConnState = { readonly: boolean; ip: string } | null;
type BlockRecord = { at: number; reason?: string };

// ADR-0010: content-policy takedown. Blocked pads refuse connections with
// this code and the client renders a "removed" screen.
const CLOSE_PAD_REMOVED = 4404;
// Cap on the reason string persisted with a block and on the content
// preview returned by admin-info.
const ADMIN_REASON_MAX = 500;
const ADMIN_TEXT_PREVIEW_MAX = 64 * 1024;

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function hashPin(pin: string, existingSalt?: string): Promise<PinRecord> {
  const salt = existingSalt
    ? fromBase64(existingSalt)
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: 100_000 },
    key,
    256,
  );
  return { salt: toBase64(salt), hash: toBase64(new Uint8Array(bits)) };
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * One pad ↔ one room (ADR-0003). Holds live connections, the Yjs doc,
 * snapshot history, and the PIN/read-only gates (ADR-0005/0006/0008).
 */
export class PadRoom extends YServer<Env> {
  static callbackOptions = {
    debounceWait: 2000,
    debounceMaxWait: 10000,
  };

  private docOverCap = false;

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
    this.docOverCap =
      storedOverCap === true || (stored?.byteLength ?? 0) > MAX_DOC_BYTES;
    if (stored) {
      Y.applyUpdate(this.document, stored);
    }
  }

  async onSave() {
    const update = Y.encodeStateAsUpdate(this.document);
    // Empty docs stay unpersisted so typos/crawlers mint nothing (ADR-0004).
    if (update.byteLength <= 2) return;
    this.docOverCap = update.byteLength > MAX_DOC_BYTES;
    if (this.docOverCap) {
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

  // --- session tokens (granted on PIN verification) ---

  private async createSession(): Promise<string> {
    const token = crypto.randomUUID();
    const sessions =
      (await this.ctx.storage.get<Record<string, number>>("sessions")) ?? {};
    sessions[token] = Date.now();
    const entries = Object.entries(sessions);
    if (entries.length > MAX_SESSIONS) {
      entries.sort((a, b) => a[1] - b[1]);
      for (const [old] of entries.slice(0, entries.length - MAX_SESSIONS)) {
        delete sessions[old];
      }
    }
    await this.ctx.storage.put("sessions", sessions);
    return token;
  }

  private async isValidSession(token: string): Promise<boolean> {
    const sessions =
      await this.ctx.storage.get<Record<string, number>>("sessions");
    const grantedAt = sessions?.[token];
    if (grantedAt === undefined) return false;
    if (Date.now() - grantedAt > SESSION_TTL_MS) {
      delete sessions![token];
      await this.ctx.storage.put("sessions", sessions);
      return false;
    }
    return true;
  }

  // --- PIN brute-force backoff (ADR-0009) ---

  /** Milliseconds the caller must still wait before the next PIN attempt. */
  private async pinRetryDelay(): Promise<number> {
    const fails = await this.ctx.storage.get<PinFails>("pinFails");
    if (!fails || fails.count < PIN_FREE_ATTEMPTS) return 0;
    const wait = Math.min(
      1000 * 2 ** (fails.count - PIN_FREE_ATTEMPTS),
      PIN_BACKOFF_MAX_MS,
    );
    return Math.max(0, fails.lastAt + wait - Date.now());
  }

  private async recordPinFailure(): Promise<void> {
    const fails = (await this.ctx.storage.get<PinFails>("pinFails")) ?? {
      count: 0,
      lastAt: 0,
    };
    await this.ctx.storage.put("pinFails", {
      count: fails.count + 1,
      lastAt: Date.now(),
    });
  }

  /** Edit access: no PIN set, or a valid session token. */
  private async canEdit(token: string | null): Promise<boolean> {
    const pin = await this.ctx.storage.get<PinRecord>("pin");
    if (!pin) return true;
    return !!token && (await this.isValidSession(token));
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
      if (!(await this.canEdit(url.searchParams.get("token")))) {
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
    return this.docOverCap;
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

  // --- HTTP surface: /parties/pad-room/:slug?op=... ---

  private async readJson<T>(request: Request): Promise<T | null> {
    try {
      return (await request.json()) as T;
    } catch {
      return null;
    }
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const op = url.searchParams.get("op");
    const token = url.searchParams.get("token");

    // ADR-0010: admin surface. Without a valid secret it is indistinguishable
    // from an unknown op, and it is disabled entirely when no secret is set.
    if (op?.startsWith("admin-")) {
      if (!this.isAdmin(request)) {
        return Response.json({ error: "unknown-op" }, { status: 404 });
      }
      return this.onAdminRequest(op, request);
    }

    // A blocked pad answers info (so the client can render the removed
    // screen without connecting) and refuses everything else.
    const blocked = await this.ctx.storage.get<BlockRecord>("blocked");
    if (blocked) {
      if (op === "info" && request.method === "GET") {
        return Response.json({ pinProtected: false, removed: true });
      }
      return Response.json({ error: "pad-removed" }, { status: 410 });
    }

    const pin = await this.ctx.storage.get<PinRecord>("pin");

    if (op === "info" && request.method === "GET") {
      return Response.json({ pinProtected: !!pin });
    }

    if (op === "verify-pin" && request.method === "POST") {
      if (!pin) return Response.json({ error: "no-pin" }, { status: 400 });
      const retryIn = await this.pinRetryDelay();
      if (retryIn > 0) {
        return Response.json(
          { error: "too-many-attempts", retryInMs: retryIn },
          {
            status: 429,
            headers: { "retry-after": String(Math.ceil(retryIn / 1000)) },
          },
        );
      }
      const body = await this.readJson<{ pin?: string }>(request);
      if (!body) return Response.json({ error: "bad-json" }, { status: 400 });
      const candidate = typeof body.pin === "string" ? body.pin : "";
      const hashed = await hashPin(candidate, pin.salt);
      if (!safeEqual(hashed.hash, pin.hash)) {
        await this.recordPinFailure();
        return Response.json({ error: "wrong-pin" }, { status: 403 });
      }
      await this.ctx.storage.delete("pinFails");
      return Response.json({ token: await this.createSession() });
    }

    if (op === "set-pin" && request.method === "POST") {
      if (pin && !(await this.canEdit(token))) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const body = await this.readJson<{ pin?: string; remove?: boolean }>(
        request,
      );
      if (!body) return Response.json({ error: "bad-json" }, { status: 400 });
      if (body.remove) {
        await this.ctx.storage.delete("pin");
        await this.ctx.storage.delete("sessions");
        return Response.json({ ok: true });
      }
      const newPin = typeof body.pin === "string" ? body.pin.trim() : "";
      if (newPin.length < 4 || newPin.length > 64) {
        return Response.json({ error: "invalid-pin" }, { status: 400 });
      }
      await this.ctx.storage.put("pin", await hashPin(newPin));
      await this.ctx.storage.delete("sessions");
      return Response.json({ token: await this.createSession() });
    }

    if (op === "ro-token" && request.method === "GET") {
      if (!(await this.canEdit(token))) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      let roToken = await this.ctx.storage.get<string>("roToken");
      if (!roToken) {
        roToken = crypto.randomUUID();
        await this.ctx.storage.put("roToken", roToken);
      }
      return Response.json({ token: roToken });
    }

    // ADR-0009: rotating mints a new token; old read-only links stop working
    // (live read-only sockets stay open until they reconnect).
    if (op === "ro-token" && request.method === "POST") {
      if (!(await this.canEdit(token))) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const roToken = crypto.randomUUID();
      await this.ctx.storage.put("roToken", roToken);
      return Response.json({ token: roToken });
    }

    if (op === "snapshots" && request.method === "GET") {
      if (pin && !(await this.canEdit(token))) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const rows = this.ctx.storage.sql
        .exec("SELECT id, created_at, size FROM snapshots ORDER BY id DESC")
        .toArray();
      return Response.json(
        rows.map((r) => ({
          id: r.id as number,
          createdAt: r.created_at as number,
          size: r.size as number,
        })),
      );
    }

    if (op === "restore" && request.method === "POST") {
      if (!(await this.canEdit(token))) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const body = await this.readJson<{ id?: number }>(request);
      if (!body) return Response.json({ error: "bad-json" }, { status: 400 });
      const rows = this.ctx.storage.sql
        .exec("SELECT data FROM snapshots WHERE id = ?", body.id ?? -1)
        .toArray();
      if (rows.length === 0) {
        return Response.json({ error: "not-found" }, { status: 404 });
      }
      const data = new Uint8Array(rows[0].data as ArrayBuffer);
      // ADR-0006: restore is applied as a new edit, never a rollback.
      // Snapshots only come from accepted, under-cap saves, so restoring one
      // is also the recovery path for a room frozen by the document cap.
      this.docOverCap = false;
      await this.ctx.storage.delete(DOC_OVER_CAP_KEY);
      this.unstable_replaceDocument(data, (key) =>
        key === "document" ? "XmlFragment" : "Map",
      );
      return Response.json({ ok: true });
    }

    return Response.json({ error: "unknown-op" }, { status: 404 });
  }

  // --- admin surface (ADR-0010): reactive takedown, addressed by slug ---

  private isAdmin(request: Request): boolean {
    const secret = this.env.ADMIN_SECRET;
    if (!secret) return false;
    const auth = request.headers.get("authorization") ?? "";
    const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    return provided.length > 0 && safeEqual(provided, secret);
  }

  private closeAllConnections(): void {
    for (const conn of this.getConnections()) {
      conn.close(CLOSE_PAD_REMOVED, "pad-removed");
    }
  }

  private async onAdminRequest(op: string, request: Request): Promise<Response> {
    if (op === "admin-info" && request.method === "GET") {
      const [pin, blocked, lastSnapshotAt, stored] = await Promise.all([
        this.ctx.storage.get<PinRecord>("pin"),
        this.ctx.storage.get<BlockRecord>("blocked"),
        this.ctx.storage.get<number>("lastSnapshotAt"),
        this.ctx.storage.get<Uint8Array>("doc"),
      ]);
      const snapshots = this.ctx.storage.sql
        .exec("SELECT COUNT(*) AS n FROM snapshots")
        .one().n as number;
      // Inspect the persisted doc, not the live one: this is what moderation
      // acts on, and it works even through a PIN (view-gated for visitors,
      // not for enforcement).
      let text = "";
      if (stored) {
        const probe = new Y.Doc();
        Y.applyUpdate(probe, stored);
        text = probe.getXmlFragment("document").toString();
      }
      return Response.json({
        slug: this.name,
        pinProtected: !!pin,
        blocked: blocked ?? null,
        docBytes: stored?.byteLength ?? 0,
        snapshots,
        lastSnapshotAt: lastSnapshotAt ?? null,
        liveConnections: [...this.getConnections()].length,
        text: text.slice(0, ADMIN_TEXT_PREVIEW_MAX),
      });
    }

    if (op === "admin-block" && request.method === "POST") {
      const body =
        (await this.readJson<{ reason?: string }>(request)) ?? {};
      const record: BlockRecord = { at: Date.now() };
      if (typeof body.reason === "string" && body.reason.trim()) {
        record.reason = body.reason.trim().slice(0, ADMIN_REASON_MAX);
      }
      await this.ctx.storage.put("blocked", record);
      this.closeAllConnections();
      return Response.json({ ok: true, blocked: record });
    }

    if (op === "admin-unblock" && request.method === "POST") {
      await this.ctx.storage.delete("blocked");
      return Response.json({ ok: true });
    }

    if (op === "admin-purge" && request.method === "POST") {
      const body =
        (await this.readJson<{ block?: boolean; reason?: string }>(request)) ??
        {};
      // Block before wiping so nobody reconnects into the gap; the block
      // record itself survives the purge.
      if (body.block) {
        const record: BlockRecord = { at: Date.now() };
        if (typeof body.reason === "string" && body.reason.trim()) {
          record.reason = body.reason.trim().slice(0, ADMIN_REASON_MAX);
        }
        await this.ctx.storage.put("blocked", record);
      }
      this.closeAllConnections();
      this.ctx.storage.sql.exec("DELETE FROM snapshots");
      await this.ctx.storage.delete([
        "doc",
        "pin",
        "sessions",
        "roToken",
        "lastSnapshotAt",
        "pinFails",
        DOC_OVER_CAP_KEY,
      ]);
      // Reset the live doc too, or a warm room would resurrect content on
      // the next connect. (unstable_replaceDocument can't target an empty
      // snapshot — its UndoManager needs at least one root type.) Deleting
      // in a transaction lets Yjs GC drop the content bytes.
      const frag = this.document.getXmlFragment("document");
      if (frag.length > 0) {
        this.document.transact(() => frag.delete(0, frag.length));
      }
      this.docOverCap = false;
      return Response.json({ ok: true, blocked: !!body.block });
    }

    return Response.json({ error: "unknown-op" }, { status: 404 });
  }
}

// --- Worker: parties routing, API, OG tags for crawlers, asset serving ---

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
  ].join("; ");
}

function withSecurityHeaders(response: Response, hostname: string): Response {
  const res = new Response(response.body, response);
  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("referrer-policy", "no-referrer");
  // Vite dev injects inline scripts (react-refresh); CSP is prod-only.
  const isDev = hostname === "localhost" || hostname === "127.0.0.1";
  if (!isDev) res.headers.set("content-security-policy", csp(hostname));
  return res;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const roomResponse = await routePartykitRequest(request, env as never);
    if (roomResponse) return roomResponse;

    const url = new URL(request.url);
    // With asset-first routing, a missing hashed chunk falls through to the
    // Worker. Never turn that miss into the SPA shell: HTML cached as
    // JavaScript would break clients after a deployment.
    if (url.pathname.startsWith("/assets/")) {
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

    return withSecurityHeaders(await env.ASSETS.fetch(request), url.hostname);
  },
} satisfies ExportedHandler<Env>;
