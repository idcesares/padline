import type { Connection, ConnectionContext } from "partyserver";
import { YServer } from "y-partyserver";
import * as Y from "yjs";
import {
  CLOSE,
  MAX_CONNECTIONS,
  MAX_DOC_BYTES,
  MAX_MESSAGE_BYTES,
  MSG_PAD_FULL,
  MSG_PAD_OK,
  TEXT_KEY,
} from "../shared/limits";
import { EXCERPT_CHARS } from "../shared/moderation";
import { isValidSlug } from "../shared/slug";

export type Env = {
  PadRoom: DurableObjectNamespace<PadRoom>;
  ASSETS: Fetcher;
  DB: D1Database;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Local development only; see worker/access.ts. */
  ADMIN_DEV_BYPASS?: string;
};

const DOC_KEY = "doc";
const OVER_CAP_KEY = "docOverCap";
const BLOCKED_KEY = "blocked";

/** The pad index is written at most this often per room (ADR-0002). */
const INDEX_INTERVAL_MS = 60_000;

const UPSERT_PAD = `
  INSERT INTO pads (slug, size, created, last_edit, edits, status)
  VALUES (?1, ?2, ?3, ?3, 1, 'live')
  ON CONFLICT (slug) DO UPDATE SET
    size = excluded.size,
    last_edit = excluded.last_edit,
    edits = edits + 1,
    status = CASE
      WHEN status = 'blocked' THEN status
      WHEN ?4 = 1 AND status = 'emptied' THEN status
      ELSE 'live'
    END`;

/**
 * Past this the room stops listening altogether. Between MAX_DOC_BYTES and
 * here a visitor can still delete text to get back under the limit; the
 * ceiling keeps one client from growing a warm document without bound.
 */
const HARD_CAP_BYTES = MAX_DOC_BYTES * 2;

/** The public statement of reasons for a block: category and date, nothing else. */
type BlockRecord = { at: number; category: string };

export type PadExcerpt = { excerpt: string; length: number; size: number };

/**
 * One pad, one room (ADR-0001, ADR-0003). Holds the live connections and the
 * pad's Yjs document, and enforces the limits. It is the enforcement authority
 * for a block (ADR-0002); nothing else decides whether a pad is blocked.
 *
 * Storage is plain key-value on purpose: `doc`, `docOverCap` and `blocked` are
 * the only keys read. Anything else in a room's storage is ignored.
 */
export class PadRoom extends YServer<Env> {
  static callbackOptions = {
    debounceWait: 2000,
    debounceMaxWait: 10000,
  };

  /** Mirrors OVER_CAP_KEY so isReadOnly stays synchronous. */
  private overCap = false;
  private hardFrozen = false;
  /** Mirrors BLOCKED_KEY so a pending save cannot bring a blocked pad back. */
  private blocked = false;
  private lastIndexAt = 0;

  async onLoad() {
    const [stored, storedOverCap, blocked] = await Promise.all([
      this.ctx.storage.get<Uint8Array>(DOC_KEY),
      this.ctx.storage.get<boolean>(OVER_CAP_KEY),
      this.ctx.storage.get<BlockRecord>(BLOCKED_KEY),
    ]);
    this.overCap = storedOverCap === true;
    this.blocked = blocked !== undefined;
    if (stored && !this.blocked) Y.applyUpdate(this.document, stored);
  }

  async onSave() {
    if (this.blocked) return;
    const update = Y.encodeStateAsUpdate(this.document);
    // An empty document stays unpersisted, so typos and crawlers mint nothing
    // (ADR-0003).
    if (update.byteLength <= 2) return;

    const wasOverCap = this.overCap;
    this.overCap = update.byteLength > MAX_DOC_BYTES;
    this.hardFrozen = update.byteLength > HARD_CAP_BYTES;
    if (this.overCap) {
      // The last accepted state is what survives. Edits made while full live
      // in the warm room and in each visitor's device cache until they delete
      // enough text to fit.
      await this.ctx.storage.put(OVER_CAP_KEY, true);
      this.broadcastCustomMessage(MSG_PAD_FULL);
      await this.recordIndex(update.byteLength);
      return;
    }
    if (wasOverCap) {
      await this.ctx.storage.delete(OVER_CAP_KEY);
      this.broadcastCustomMessage(MSG_PAD_OK);
    }
    await this.ctx.storage.put(DOC_KEY, update);
    await this.recordIndex(update.byteLength);
  }

  /**
   * The pad index (ADR-0002): the first non-empty save inserts the row, later
   * saves update it at most once a minute. A write skipped for the throttle is
   * flushed by an alarm, so the last minute of an active pad is not lost when
   * the room hibernates. A D1 failure never fails a save.
   */
  private async recordIndex(size: number): Promise<void> {
    const now = Date.now();
    if (now - this.lastIndexAt >= INDEX_INTERVAL_MS) {
      await this.writeIndex(size, now);
      return;
    }
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(this.lastIndexAt + INDEX_INTERVAL_MS);
    }
  }

  private async writeIndex(size: number, now: number): Promise<void> {
    if (this.blocked) return;
    this.lastIndexAt = now;
    try {
      // An emptied pad stays "emptied" until someone writes into it again.
      const empty = this.document.getText(TEXT_KEY).length === 0 ? 1 : 0;
      await this.env.DB.prepare(UPSERT_PAD).bind(this.name, size, now, empty).run();
    } catch (error) {
      console.error("pad index write failed", error);
    }
  }

  async onAlarm() {
    // Only set when a write was throttled, so there is always something to flush.
    await this.writeIndex(Y.encodeStateAsUpdate(this.document).byteLength, Date.now());
  }

  /**
   * Operator actions. Reached only by RPC from the Worker's admin API, which
   * checks Cloudflare Access first; the public route has no path to them.
   */
  async adminExcerpt(): Promise<PadExcerpt> {
    const text = this.document.getText(TEXT_KEY);
    return {
      excerpt: this.blocked ? "" : text.toString().slice(0, EXCERPT_CHARS),
      length: text.length,
      size: Y.encodeStateAsUpdate(this.document).byteLength,
    };
  }

  /**
   * Deletes the pad's text as a Yjs edit, so the deletion reaches every
   * connected client and wins over any copy a device cache replays. The pad
   * stays open for new text and is not marked removed.
   */
  async adminClear(): Promise<{ size: number; blocked: boolean }> {
    if (this.blocked) return { size: 0, blocked: true };
    const text = this.document.getText(TEXT_KEY);
    this.document.transact(() => text.delete(0, text.length));
    this.overCap = false;
    this.hardFrozen = false;
    await this.ctx.storage.delete(OVER_CAP_KEY);
    const update = Y.encodeStateAsUpdate(this.document);
    await this.ctx.storage.put(DOC_KEY, update);
    this.broadcastCustomMessage(MSG_PAD_OK);
    return { size: update.byteLength, blocked: false };
  }

  /**
   * The block: the stored text is gone, the slug answers 4404 from now on, and
   * every open connection is closed with it. Nothing else decides this.
   */
  async adminBlock(category: string): Promise<{ done: boolean; category: string }> {
    // A second block must not overwrite the first record's category and date.
    if (this.blocked) {
      const kept = await this.ctx.storage.get<BlockRecord>(BLOCKED_KEY);
      return { done: false, category: kept?.category ?? category };
    }
    this.blocked = true;
    await this.ctx.storage.put<BlockRecord>(BLOCKED_KEY, { at: Date.now(), category });
    await this.ctx.storage.delete([DOC_KEY, OVER_CAP_KEY]);
    await this.ctx.storage.deleteAlarm();
    for (const conn of this.getConnections()) {
      conn.close(CLOSE.removed, "pad-removed");
    }
    return { done: true, category };
  }

  async onConnect(conn: Connection, ctx: ConnectionContext) {
    if (!isValidSlug(this.name)) {
      conn.close(CLOSE.invalidSlug, "invalid-slug");
      return;
    }
    if (await this.ctx.storage.get<BlockRecord>(BLOCKED_KEY)) {
      conn.close(CLOSE.removed, "pad-removed");
      return;
    }
    // partyserver has already registered `conn`, so it is part of this count.
    if ([...this.getConnections()].length > MAX_CONNECTIONS) {
      conn.close(CLOSE.busy, "pad-busy");
      return;
    }
    super.onConnect(conn, ctx);
    if (this.overCap) this.sendCustomMessage(conn, MSG_PAD_FULL);
  }

  isReadOnly(): boolean {
    return this.hardFrozen;
  }

  onMessage(conn: Connection, message: string | ArrayBuffer | ArrayBufferView) {
    const size =
      typeof message === "string"
        ? new TextEncoder().encode(message).byteLength
        : message.byteLength;
    if (size > MAX_MESSAGE_BYTES) {
      conn.close(CLOSE.tooLarge, "message-too-large");
      return;
    }
    super.onMessage(conn, message);
  }

  /**
   * `?op=status`: what a visitor may learn about a pad that was removed. The
   * category and date only; the operator's reason never leaves the room
   * (ADR-0002). Reveals nothing about pads that exist and are not blocked.
   */
  async onRequest(request: Request): Promise<Response> {
    const op = new URL(request.url).searchParams.get("op");
    if (op !== "status" || request.method !== "GET") {
      return Response.json({ error: "unknown-op" }, { status: 404 });
    }
    const blocked = await this.ctx.storage.get<BlockRecord>(BLOCKED_KEY);
    return Response.json({
      removed: blocked
        ? { at: blocked.at, category: blocked.category }
        : null,
    });
  }
}
