import * as Y from "yjs";

/**
 * The pad's rich-text root. Every persisted transition — restore, purge, and
 * operator inspection — reads or rewrites this one key, so its name and its
 * Yjs root type live here rather than at each call site.
 */
const DOCUMENT_FRAGMENT = "document";

// ADR-0008: cheap-to-enforce, catastrophic-to-miss invariants.
const MAX_DOC_BYTES = 2 * 1024 * 1024;

// ADR-0006: snapshot cadence and retention.
const SNAPSHOT_MIN_INTERVAL_MS = 60_000;
const SNAPSHOT_KEEP = 100;

const DOC_KEY = "doc";
const DOC_OVER_CAP_KEY = "docOverCap";
const LAST_SNAPSHOT_AT_KEY = "lastSnapshotAt";

export type SnapshotMeta = { id: number; createdAt: number; size: number };

export type RestoreOutcome = { ok: true } | { ok: false; reason: "not-found" };

export type PersistedPadInfo = {
  docBytes: number;
  snapshots: number;
  lastSnapshotAt: number | null;
  text: string;
};

/** Narrower than y-partyserver's root union: a pad has only these two shapes. */
type DocumentRootType = "XmlFragment" | "Map";

type RoomPersistenceContext = {
  storage: DurableObjectStorage;
  document: Y.Doc;
  replaceDocument: (
    data: Uint8Array,
    rootType: (key: string) => DocumentRootType,
  ) => void;
};

/**
 * Everything durable about a pad: the stored document, its snapshot history,
 * and the size-cap freeze. It owns the live Yjs document's half of each
 * transition too, because a restore or a purge that changed storage without
 * changing the warm document would leave the Room serving content the pad no
 * longer has (ADR-0006, ADR-0010).
 *
 * Storage keys and the snapshot schema are private: callers ask for outcomes.
 */
export class RoomPersistence {
  /** Mirrors DOC_OVER_CAP_KEY so the read-only check stays synchronous. */
  private overCap = false;

  constructor(private readonly context: RoomPersistenceContext) {}

  async load(): Promise<void> {
    this.context.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        size INTEGER NOT NULL,
        data BLOB NOT NULL
      )`,
    );
    const [stored, storedOverCap] = await Promise.all([
      this.context.storage.get<Uint8Array>(DOC_KEY),
      this.context.storage.get<boolean>(DOC_OVER_CAP_KEY),
    ]);
    this.overCap =
      storedOverCap === true || (stored?.byteLength ?? 0) > MAX_DOC_BYTES;
    if (stored) {
      Y.applyUpdate(this.context.document, stored);
    }
  }

  async save(): Promise<void> {
    const update = Y.encodeStateAsUpdate(this.context.document);
    // Empty docs stay unpersisted so typos/crawlers mint nothing (ADR-0004).
    if (update.byteLength <= 2) return;
    this.overCap = update.byteLength > MAX_DOC_BYTES;
    if (this.overCap) {
      // The freeze marker is persisted but the document is not, so the last
      // accepted state is what survives — and the freeze survives eviction.
      await this.context.storage.put(DOC_OVER_CAP_KEY, true);
      return;
    }
    await this.context.storage.delete(DOC_OVER_CAP_KEY);
    await this.context.storage.put(DOC_KEY, update);
    await this.maybeSnapshot(update);
  }

  /** True once the document cap has frozen the pad, until a restore or purge. */
  isFrozen(): boolean {
    return this.overCap;
  }

  listSnapshots(): SnapshotMeta[] {
    return this.context.storage.sql
      .exec("SELECT id, created_at, size FROM snapshots ORDER BY id DESC")
      .toArray()
      .map((row) => ({
        id: row.id as number,
        createdAt: row.created_at as number,
        size: row.size as number,
      }));
  }

  /**
   * ADR-0006: restore is a new edit, never a rollback. An accepted snapshot is
   * also the recovery path for a Room frozen by the document cap.
   */
  async restoreSnapshot(id: number | undefined): Promise<RestoreOutcome> {
    const rows = this.context.storage.sql
      .exec("SELECT data FROM snapshots WHERE id = ?", id ?? -1)
      .toArray();
    if (rows.length === 0) return { ok: false, reason: "not-found" };
    const data = new Uint8Array(rows[0].data as ArrayBuffer);
    this.overCap = false;
    await this.context.storage.delete(DOC_OVER_CAP_KEY);
    this.context.replaceDocument(data, (key) =>
      key === DOCUMENT_FRAGMENT ? "XmlFragment" : "Map",
    );
    return { ok: true };
  }

  /**
   * ADR-0010: enforcement inspects persisted content, not the live document,
   * and therefore remains available through a visitor-facing PIN.
   */
  async inspect(textLimit: number): Promise<PersistedPadInfo> {
    const [stored, lastSnapshotAt] = await Promise.all([
      this.context.storage.get<Uint8Array>(DOC_KEY),
      this.context.storage.get<number>(LAST_SNAPSHOT_AT_KEY),
    ]);
    const snapshots = this.context.storage.sql
      .exec("SELECT COUNT(*) AS n FROM snapshots")
      .one().n as number;
    let text = "";
    if (stored) {
      const probe = new Y.Doc();
      Y.applyUpdate(probe, stored);
      text = probe.getXmlFragment(DOCUMENT_FRAGMENT).toString();
    }
    return {
      docBytes: stored?.byteLength ?? 0,
      snapshots,
      lastSnapshotAt: lastSnapshotAt ?? null,
      text: text.slice(0, textLimit),
    };
  }

  /** Wipes durable pad content and the warm document that mirrors it. */
  async purge(): Promise<void> {
    this.context.storage.sql.exec("DELETE FROM snapshots");
    await this.context.storage.delete([
      DOC_KEY,
      LAST_SNAPSHOT_AT_KEY,
      DOC_OVER_CAP_KEY,
    ]);
    // Reset the live document too, or a warm Room would resurrect content on
    // the next connect. Removing fragment content lets Yjs GC drop the bytes.
    const fragment = this.context.document.getXmlFragment(DOCUMENT_FRAGMENT);
    if (fragment.length > 0) {
      this.context.document.transact(() => fragment.delete(0, fragment.length));
    }
    this.overCap = false;
  }

  private async maybeSnapshot(update: Uint8Array): Promise<void> {
    const last =
      (await this.context.storage.get<number>(LAST_SNAPSHOT_AT_KEY)) ?? 0;
    const now = Date.now();
    if (now - last < SNAPSHOT_MIN_INTERVAL_MS) return;
    this.context.storage.sql.exec(
      "INSERT INTO snapshots (created_at, size, data) VALUES (?, ?, ?)",
      now,
      update.byteLength,
      update.buffer.slice(
        update.byteOffset,
        update.byteOffset + update.byteLength,
      ),
    );
    this.context.storage.sql.exec(
      `DELETE FROM snapshots WHERE id NOT IN
        (SELECT id FROM snapshots ORDER BY id DESC LIMIT ${SNAPSHOT_KEEP})`,
    );
    await this.context.storage.put(LAST_SNAPSHOT_AT_KEY, now);
  }
}
