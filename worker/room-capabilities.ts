import type { Connection } from "partyserver";
import * as Y from "yjs";
import {
  hashPin,
  RoomSecurity,
  safeEqual,
  type PinRecord,
} from "./room-security";

export const CLOSE_PAD_REMOVED = 4404;
export const DOC_OVER_CAP_KEY = "docOverCap";

export type BlockRecord = { at: number; reason?: string };
export type RoomRuntimeState = { docOverCap: boolean };

type RoomCapabilitiesContext = {
  storage: DurableObjectStorage;
  security: RoomSecurity;
  roomName: string;
  document: Y.Doc;
  runtime: RoomRuntimeState;
  connections: () => Iterable<Connection>;
  replaceDocument: (data: Uint8Array) => void;
};

type CapabilityRequest = {
  request: Request;
  op: string | null;
  token: string | null;
  pin: PinRecord | undefined;
};

const ADMIN_REASON_MAX = 500;
const ADMIN_TEXT_PREVIEW_MAX = 64 * 1024;

/**
 * The Room's HTTP capability implementation. Its single interface preserves
 * the external Room seam while authorization, storage changes, and response
 * mapping stay local to each capability path.
 */
export class RoomCapabilities {
  constructor(private readonly context: RoomCapabilitiesContext) {}

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const op = url.searchParams.get("op");

    // ADR-0010: admin concealment outranks every other request decision.
    if (op?.startsWith("admin-")) {
      if (!(await this.context.security.isAdmin(request))) {
        return this.unknownOperation();
      }
      return this.handleTakedown(op, request);
    }

    // A block outranks ordinary pad capabilities. Public info remains visible
    // so the client can render the removed state without opening a socket.
    const blocked = await this.context.storage.get<BlockRecord>("blocked");
    if (blocked) {
      if (op === "info" && request.method === "GET") {
        return Response.json({ pinProtected: false, removed: true });
      }
      return Response.json({ error: "pad-removed" }, { status: 410 });
    }

    const capabilityRequest: CapabilityRequest = {
      request,
      op,
      token: url.searchParams.get("token"),
      pin: await this.context.storage.get<PinRecord>("pin"),
    };

    return (
      (await this.handleAccess(capabilityRequest)) ??
      (await this.handleReadOnlyLink(capabilityRequest)) ??
      (await this.handleSnapshotHistory(capabilityRequest)) ??
      this.unknownOperation()
    );
  }

  private async handleAccess({
    request,
    op,
    token,
    pin,
  }: CapabilityRequest): Promise<Response | null> {
    if (op === "info" && request.method === "GET") {
      return Response.json({ pinProtected: !!pin });
    }

    if (op === "verify-pin" && request.method === "POST") {
      if (!pin) return Response.json({ error: "no-pin" }, { status: 400 });
      const retryIn = await this.context.security.pinRetryDelay();
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
        await this.context.security.recordPinFailure();
        return Response.json({ error: "wrong-pin" }, { status: 403 });
      }
      await this.context.storage.delete("pinFails");
      return Response.json({
        token: await this.context.security.createSession(),
      });
    }

    if (op !== "set-pin" || request.method !== "POST") return null;

    if (pin && !(await this.context.security.canEdit(token))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = await this.readJson<{ pin?: string; remove?: boolean }>(
      request,
    );
    if (!body) return Response.json({ error: "bad-json" }, { status: 400 });
    if (body.remove) {
      await this.context.storage.delete("pin");
      await this.context.storage.delete("sessions");
      return Response.json({ ok: true });
    }
    const newPin = typeof body.pin === "string" ? body.pin.trim() : "";
    if (newPin.length < 4 || newPin.length > 64) {
      return Response.json({ error: "invalid-pin" }, { status: 400 });
    }
    await this.context.storage.put("pin", await hashPin(newPin));
    await this.context.storage.delete("sessions");
    return Response.json({
      token: await this.context.security.createSession(),
    });
  }

  private async handleReadOnlyLink({
    request,
    op,
    token,
  }: CapabilityRequest): Promise<Response | null> {
    if (op !== "ro-token") return null;
    if (request.method !== "GET" && request.method !== "POST") return null;
    if (!(await this.context.security.canEdit(token))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    if (request.method === "GET") {
      let roToken = await this.context.storage.get<string>("roToken");
      if (!roToken) {
        roToken = crypto.randomUUID();
        await this.context.storage.put("roToken", roToken);
      }
      return Response.json({ token: roToken });
    }

    // ADR-0009: rotating mints a new token; old read-only links stop working
    // when they reconnect. Existing read-only sockets stay open.
    const roToken = crypto.randomUUID();
    await this.context.storage.put("roToken", roToken);
    return Response.json({ token: roToken });
  }

  private async handleSnapshotHistory({
    request,
    op,
    token,
    pin,
  }: CapabilityRequest): Promise<Response | null> {
    if (op === "snapshots" && request.method === "GET") {
      if (pin && !(await this.context.security.canEdit(token))) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const rows = this.context.storage.sql
        .exec("SELECT id, created_at, size FROM snapshots ORDER BY id DESC")
        .toArray();
      return Response.json(
        rows.map((row) => ({
          id: row.id as number,
          createdAt: row.created_at as number,
          size: row.size as number,
        })),
      );
    }

    if (op !== "restore" || request.method !== "POST") return null;

    if (!(await this.context.security.canEdit(token))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = await this.readJson<{ id?: number }>(request);
    if (!body) return Response.json({ error: "bad-json" }, { status: 400 });
    const rows = this.context.storage.sql
      .exec("SELECT data FROM snapshots WHERE id = ?", body.id ?? -1)
      .toArray();
    if (rows.length === 0) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    const data = new Uint8Array(rows[0].data as ArrayBuffer);
    // ADR-0006: restore is a new edit. Accepted snapshots are also the
    // recovery path for a Room frozen by the document cap.
    this.context.runtime.docOverCap = false;
    await this.context.storage.delete(DOC_OVER_CAP_KEY);
    this.context.replaceDocument(data);
    return Response.json({ ok: true });
  }

  private async handleTakedown(
    op: string,
    request: Request,
  ): Promise<Response> {
    if (op === "admin-info" && request.method === "GET") {
      const [pin, blocked, lastSnapshotAt, stored] = await Promise.all([
        this.context.storage.get<PinRecord>("pin"),
        this.context.storage.get<BlockRecord>("blocked"),
        this.context.storage.get<number>("lastSnapshotAt"),
        this.context.storage.get<Uint8Array>("doc"),
      ]);
      const snapshots = this.context.storage.sql
        .exec("SELECT COUNT(*) AS n FROM snapshots")
        .one().n as number;
      // Enforcement inspects persisted content, not the live document, and
      // therefore remains available through a visitor-facing PIN.
      let text = "";
      if (stored) {
        const probe = new Y.Doc();
        Y.applyUpdate(probe, stored);
        text = probe.getXmlFragment("document").toString();
      }
      return Response.json({
        slug: this.context.roomName,
        pinProtected: !!pin,
        blocked: blocked ?? null,
        docBytes: stored?.byteLength ?? 0,
        snapshots,
        lastSnapshotAt: lastSnapshotAt ?? null,
        liveConnections: [...this.context.connections()].length,
        text: text.slice(0, ADMIN_TEXT_PREVIEW_MAX),
      });
    }

    if (op === "admin-block" && request.method === "POST") {
      const body =
        (await this.readJson<{ reason?: string }>(request)) ?? {};
      const record = this.blockRecord(body.reason);
      await this.context.storage.put("blocked", record);
      this.closeAllConnections();
      return Response.json({ ok: true, blocked: record });
    }

    if (op === "admin-unblock" && request.method === "POST") {
      await this.context.storage.delete("blocked");
      return Response.json({ ok: true });
    }

    if (op !== "admin-purge" || request.method !== "POST") {
      return this.unknownOperation();
    }

    const body =
      (await this.readJson<{ block?: boolean; reason?: string }>(request)) ?? {};
    // Block before wiping so nobody reconnects into the gap. The block record
    // intentionally survives the purge.
    if (body.block) {
      await this.context.storage.put("blocked", this.blockRecord(body.reason));
    }
    this.closeAllConnections();
    this.context.storage.sql.exec("DELETE FROM snapshots");
    await this.context.storage.delete([
      "doc",
      "pin",
      "sessions",
      "roToken",
      "lastSnapshotAt",
      "pinFails",
      DOC_OVER_CAP_KEY,
    ]);
    // Reset the live document too, or a warm Room would resurrect content on
    // the next connect. Removing fragment content lets Yjs GC drop the bytes.
    const fragment = this.context.document.getXmlFragment("document");
    if (fragment.length > 0) {
      this.context.document.transact(() =>
        fragment.delete(0, fragment.length),
      );
    }
    this.context.runtime.docOverCap = false;
    return Response.json({ ok: true, blocked: !!body.block });
  }

  private blockRecord(reason: unknown): BlockRecord {
    const record: BlockRecord = { at: Date.now() };
    if (typeof reason === "string" && reason.trim()) {
      record.reason = reason.trim().slice(0, ADMIN_REASON_MAX);
    }
    return record;
  }

  private closeAllConnections(): void {
    for (const connection of this.context.connections()) {
      connection.close(CLOSE_PAD_REMOVED, "pad-removed");
    }
  }

  private async readJson<T>(request: Request): Promise<T | null> {
    try {
      return (await request.json()) as T;
    } catch {
      return null;
    }
  }

  private unknownOperation(): Response {
    return Response.json({ error: "unknown-op" }, { status: 404 });
  }
}
