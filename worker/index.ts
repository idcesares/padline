import { Hono } from "hono";
import {
  routePartykitRequest,
  type Connection,
  type ConnectionContext,
} from "partyserver";
import { YServer } from "y-partyserver";
import * as Y from "yjs";

type Env = {
  PadRoom: DurableObjectNamespace;
  ASSETS: Fetcher;
};

// ADR-0008: cheap-to-enforce, catastrophic-to-miss invariants.
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 256 * 1024;
const MAX_CONNECTIONS = 50;
const MAX_SESSIONS = 200;

// ADR-0006: snapshot cadence and retention.
const SNAPSHOT_MIN_INTERVAL_MS = 60_000;
const SNAPSHOT_KEEP = 100;

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set(["api", "assets", "parties", "p", "r", "admin"]);

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug);
}

type PinRecord = { salt: string; hash: string };
type ConnState = { readonly: boolean } | null;

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
    const stored = await this.ctx.storage.get<Uint8Array>("doc");
    if (stored) {
      Y.applyUpdate(this.document, stored);
    }
  }

  async onSave() {
    const update = Y.encodeStateAsUpdate(this.document);
    // Empty docs stay unpersisted so typos/crawlers mint nothing (ADR-0004).
    if (update.byteLength <= 2) return;
    this.docOverCap = update.byteLength > MAX_DOC_BYTES;
    if (this.docOverCap) return;
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
    return !!sessions?.[token];
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
    if ([...this.getConnections()].length > MAX_CONNECTIONS) {
      conn.close(1013, "pad-full");
      return;
    }
    const url = new URL(ctx.request.url);
    const ro = url.searchParams.get("ro");
    if (ro) {
      const roToken = await this.ctx.storage.get<string>("roToken");
      if (!roToken || !safeEqual(ro, roToken)) {
        conn.close(4403, "invalid-token");
        return;
      }
      conn.setState({ readonly: true });
    } else {
      if (!(await this.canEdit(url.searchParams.get("token")))) {
        conn.close(4401, "pin-required");
        return;
      }
      conn.setState({ readonly: false });
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
      typeof message === "string" ? message.length : message.byteLength;
    if (size > MAX_MESSAGE_BYTES) {
      conn.close(1009, "message-too-large");
      return;
    }
    // Drop anything sent before onConnect finished authorizing.
    if ((conn.state as ConnState) == null) return;
    super.onMessage(conn, message);
  }

  // --- HTTP surface: /parties/pad-room/:slug?op=... ---

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const op = url.searchParams.get("op");
    const token = url.searchParams.get("token");
    const pin = await this.ctx.storage.get<PinRecord>("pin");

    if (op === "info" && request.method === "GET") {
      return Response.json({ pinProtected: !!pin });
    }

    if (op === "verify-pin" && request.method === "POST") {
      if (!pin) return Response.json({ error: "no-pin" }, { status: 400 });
      const body = (await request.json()) as { pin?: string };
      const candidate = typeof body.pin === "string" ? body.pin : "";
      const hashed = await hashPin(candidate, pin.salt);
      if (!safeEqual(hashed.hash, pin.hash)) {
        return Response.json({ error: "wrong-pin" }, { status: 403 });
      }
      return Response.json({ token: await this.createSession() });
    }

    if (op === "set-pin" && request.method === "POST") {
      if (pin && !(await this.canEdit(token))) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const body = (await request.json()) as { pin?: string; remove?: boolean };
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
      const body = (await request.json()) as { id?: number };
      const rows = this.ctx.storage.sql
        .exec("SELECT data FROM snapshots WHERE id = ?", body.id ?? -1)
        .toArray();
      if (rows.length === 0) {
        return Response.json({ error: "not-found" }, { status: 404 });
      }
      const data = new Uint8Array(rows[0].data as ArrayBuffer);
      // ADR-0006: restore is applied as a new edit, never a rollback.
      this.unstable_replaceDocument(data, (key) =>
        key === "document" ? "XmlFragment" : "Map",
      );
      return Response.json({ ok: true });
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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const roomResponse = await routePartykitRequest(request, env as never);
    if (roomResponse) return roomResponse;

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }

    const slug = url.pathname.slice(1);
    if (
      isValidSlug(slug) &&
      CRAWLER_RE.test(request.headers.get("user-agent") ?? "")
    ) {
      return ogResponse(slug, url.origin);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
