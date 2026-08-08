import type { Connection } from "partyserver";
import type { RoomPersistence } from "./room-persistence";
import type { RoomSecurity } from "./room-security";

export const CLOSE_PAD_REMOVED = 4404;

export type BlockRecord = { at: number; reason?: string };

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

/**
 * The Room's HTTP capability implementation. Its single interface preserves
 * the external Room seam while authorization, storage changes, and response
 * mapping stay local to each capability path.
 *
 * Access credentials are RoomSecurity's (ADR-0016): this module decides
 * whether a caller is authorized, coerces request field shapes, and maps the
 * outcomes it gets back onto status codes. Keeping that mapping here means a
 * renamed domain reason cannot silently change the wire API.
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
        liveConnections: [...this.context.connections()].length,
        ...persisted,
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
    await this.context.persistence.purge();
    await this.context.security.clearSecrets();
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
