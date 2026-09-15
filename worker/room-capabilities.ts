import type { Connection } from "partyserver";
import { isReportCategory } from "../src/lib/moderation-profile";
import { toBase64 } from "./bytes";
import type { RoomPersistence } from "./room-persistence";
import type { RoomSecurity } from "./room-security";

export const CLOSE_PAD_REMOVED = 4404;
/** The operator dropped live connections (ADR-0018); clients may reconnect. */
export const CLOSE_DISCONNECTED = 4408;
/** The operator froze the pad (ADR-0018); clients reconnect read-only. */
export const CLOSE_PAD_FROZEN = 4409;

/**
 * An enforcement record in the room's own storage (ADR-0010, ADR-0018). Its
 * category and date are the public statement of reasons; `reason` is the
 * operator's note and never leaves an admin response.
 */
export type EnforcementRecord = { at: number; reason?: string; category?: string };
export type BlockRecord = EnforcementRecord;

type RoomCapabilitiesContext = {
  storage: DurableObjectStorage;
  security: RoomSecurity;
  persistence: RoomPersistence;
  roomName: string;
  connections: () => Iterable<Connection>;
};

type CapabilityRequest = {
  request: Request;
  op: string | null;
  token: string | null;
};

const ADMIN_REASON_MAX = 500;
const ADMIN_TEXT_PREVIEW_MAX = 64 * 1024;
const FROZEN_KEY = "frozen";

/**
 * The Room's HTTP capability implementation. Its single interface preserves
 * the external Room seam while authorization, storage changes, and response
 * mapping stay local to each capability path.
 *
 * Access credentials are RoomSecurity's (ADR-0016): this module decides
 * whether a caller is authorized, coerces request field shapes, and maps the
 * outcomes it gets back onto status codes. Keeping that mapping here means a
 * renamed domain reason cannot silently change the wire API.
 *
 * It also owns the two enforcement records, `blocked` and `frozen`. A freeze
 * is mirrored in memory because PadRoom.isReadOnly runs on every message and
 * must stay synchronous.
 */
export class RoomCapabilities {
  private frozen: EnforcementRecord | null = null;

  constructor(private readonly context: RoomCapabilitiesContext) {}

  async load(): Promise<void> {
    this.frozen =
      (await this.context.storage.get<EnforcementRecord>(FROZEN_KEY)) ?? null;
  }

  /** ADR-0018: a frozen pad stays readable and refuses every edit. */
  isFrozen(): boolean {
    return this.frozen !== null;
  }

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

    // A block outranks ordinary pad capabilities, and a freeze. Public info
    // remains visible so the client can render the removed state, with its
    // statement of reasons, without opening a socket.
    const blocked = await this.context.storage.get<BlockRecord>("blocked");
    if (blocked) {
      if (op === "info" && request.method === "GET") {
        return Response.json({
          pinProtected: false,
          removed: true,
          removedAt: blocked.at,
          ...publicCategory(blocked),
        });
      }
      return Response.json({ error: "pad-removed" }, { status: 410 });
    }

    const capabilityRequest: CapabilityRequest = {
      request,
      op,
      token: url.searchParams.get("token"),
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
  }: CapabilityRequest): Promise<Response | null> {
    if (op === "info" && request.method === "GET") {
      return Response.json({
        pinProtected: await this.context.security.isPinProtected(),
        ...(this.frozen
          ? { frozen: true, frozenAt: this.frozen.at, ...publicCategory(this.frozen) }
          : {}),
      });
    }

    if (op === "verify-pin" && request.method === "POST") {
      return this.verifyPinResponse(request);
    }

    if (op !== "set-pin" || request.method !== "POST") return null;

    // canEdit is already true on an unprotected pad, so this is the whole
    // gate: an unclaimed pad accepts its first PIN unauthenticated, which is
    // the accepted tradeoff of the no-account model (ADR-0009).
    if (!(await this.context.security.canEdit(token))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    // A freeze keeps content where the public and the operator can see it, so
    // it refuses a PIN change as it refuses edits.
    if (this.frozen) return frozenRefusal();
    const body = await this.readJson<{ pin?: string; remove?: boolean }>(
      request,
    );
    if (!body) return Response.json({ error: "bad-json" }, { status: 400 });
    if (body.remove) {
      await this.context.security.removePin();
      return Response.json({ ok: true });
    }
    const outcome = await this.context.security.setPin(
      typeof body.pin === "string" ? body.pin : "",
    );
    if (!outcome.ok) {
      return Response.json({ error: "invalid-pin" }, { status: 400 });
    }
    return Response.json({ token: outcome.token });
  }

  /**
   * The body is read through a callback so the order of refusals is the one
   * the caller sees today: an unprotected pad and a throttled one are both
   * answered without the request body being touched.
   */
  private async verifyPinResponse(request: Request): Promise<Response> {
    const outcome = await this.context.security.verifyPin(async () => {
      const body = await this.readJson<{ pin?: string }>(request);
      if (!body) return null;
      return typeof body.pin === "string" ? body.pin : "";
    });
    if (outcome.ok) return Response.json({ token: outcome.token });

    switch (outcome.reason) {
      case "no-pin":
        return Response.json({ error: "no-pin" }, { status: 400 });
      case "throttled":
        return Response.json(
          { error: "too-many-attempts", retryInMs: outcome.retryInMs },
          {
            status: 429,
            headers: {
              "retry-after": String(Math.ceil(outcome.retryInMs / 1000)),
            },
          },
        );
      case "unreadable":
        return Response.json({ error: "bad-json" }, { status: 400 });
      case "wrong-pin":
        return Response.json({ error: "wrong-pin" }, { status: 403 });
    }
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

    return Response.json({
      token:
        request.method === "GET"
          ? await this.context.security.readOnlyToken()
          : await this.context.security.rotateReadOnlyToken(),
    });
  }

  private async handleSnapshotHistory({
    request,
    op,
    token,
  }: CapabilityRequest): Promise<Response | null> {
    if (op === "snapshots" && request.method === "GET") {
      if (!(await this.context.security.canEdit(token))) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      return Response.json(this.context.persistence.listSnapshots());
    }

    if (op !== "restore" || request.method !== "POST") return null;

    if (!(await this.context.security.canEdit(token))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    // A restore replaces the document without passing through isReadOnly.
    if (this.frozen) return frozenRefusal();
    const body = await this.readJson<{ id?: number }>(request);
    if (!body) return Response.json({ error: "bad-json" }, { status: 400 });
    const outcome = await this.context.persistence.restoreSnapshot(body.id);
    if (!outcome.ok) {
      return Response.json({ error: outcome.reason }, { status: 404 });
    }
    return Response.json({ ok: true });
  }

  private async handleTakedown(
    op: string,
    request: Request,
  ): Promise<Response> {
    if (op === "admin-info" && request.method === "GET") {
      const [pinProtected, blocked, persisted] = await Promise.all([
        this.context.security.isPinProtected(),
        this.context.storage.get<BlockRecord>("blocked"),
        this.context.persistence.inspect(ADMIN_TEXT_PREVIEW_MAX),
      ]);
      return Response.json({
        slug: this.context.roomName,
        pinProtected,
        blocked: blocked ?? null,
        frozen: this.frozen,
        liveConnections: [...this.context.connections()].length,
        ...persisted,
      });
    }

    // ADR-0018: the whole persisted document, for the ledger to seal. Like
    // admin-info it reads through a PIN: evidence cannot be locked away.
    if (op === "admin-evidence" && request.method === "GET") {
      const [pinProtected, blocked, evidence] = await Promise.all([
        this.context.security.isPinProtected(),
        this.context.storage.get<BlockRecord>("blocked"),
        this.context.persistence.evidence(),
      ]);
      const { doc, ...persisted } = evidence;
      return Response.json({
        slug: this.context.roomName,
        pinProtected,
        blocked: blocked ?? null,
        frozen: this.frozen,
        liveConnections: [...this.context.connections()].length,
        ...persisted,
        doc: doc ? toBase64(doc) : null,
      });
    }

    if (op === "admin-block" && request.method === "POST") {
      const record = this.enforcementRecord(await this.readAdminBody(request));
      await this.context.storage.put("blocked", record);
      this.closeAllConnections(CLOSE_PAD_REMOVED, "pad-removed");
      return Response.json({ ok: true, blocked: record });
    }

    if (op === "admin-unblock" && request.method === "POST") {
      await this.context.storage.delete("blocked");
      return Response.json({ ok: true });
    }

    if (op === "admin-freeze" && request.method === "POST") {
      const record = this.enforcementRecord(await this.readAdminBody(request));
      await this.context.storage.put(FROZEN_KEY, record);
      this.frozen = record;
      // Editors reconnect and learn the pad is frozen; their sockets would
      // otherwise keep sending updates the room now drops.
      this.closeAllConnections(CLOSE_PAD_FROZEN, "pad-frozen");
      return Response.json({ ok: true, frozen: record });
    }

    if (op === "admin-unfreeze" && request.method === "POST") {
      await this.context.storage.delete(FROZEN_KEY);
      this.frozen = null;
      return Response.json({ ok: true });
    }

    if (op === "admin-disconnect" && request.method === "POST") {
      const disconnected = [...this.context.connections()].length;
      this.closeAllConnections(CLOSE_DISCONNECTED, "disconnected");
      return Response.json({ ok: true, disconnected });
    }

    if (op !== "admin-purge" || request.method !== "POST") {
      return this.unknownOperation();
    }

    const body = await this.readAdminBody(request);
    // Block before wiping so nobody reconnects into the gap. The block record
    // intentionally survives the purge.
    if (body.block === true) {
      await this.context.storage.put("blocked", this.enforcementRecord(body));
    }
    this.closeAllConnections(CLOSE_PAD_REMOVED, "pad-removed");
    await this.context.persistence.purge();
    await this.context.security.clearSecrets();
    return Response.json({ ok: true, blocked: body.block === true });
  }

  private async readAdminBody(request: Request): Promise<Record<string, unknown>> {
    return (await this.readJson<Record<string, unknown>>(request)) ?? {};
  }

  private enforcementRecord(body: Record<string, unknown>): EnforcementRecord {
    const record: EnforcementRecord = { at: Date.now() };
    if (typeof body.reason === "string" && body.reason.trim()) {
      record.reason = body.reason.trim().slice(0, ADMIN_REASON_MAX);
    }
    if (isReportCategory(body.category)) record.category = body.category;
    return record;
  }

  private closeAllConnections(code: number, reason: string): void {
    for (const connection of this.context.connections()) {
      connection.close(code, reason);
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

/** The public half of an enforcement record: never its reason. */
function publicCategory(record: EnforcementRecord): { category?: string } {
  return record.category ? { category: record.category } : {};
}

function frozenRefusal(): Response {
  return Response.json({ error: "pad-frozen" }, { status: 423 });
}
