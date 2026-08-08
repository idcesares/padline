import {
  env,
  SELF,
  evictDurableObject,
  runInDurableObject,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { PadRoom } from "../worker";

const roomUrl = (slug: string, query = "") =>
  `https://padline.test/parties/pad-room/${slug}${query}`;

const uniqueSlug = (prefix: string) =>
  `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

const ADMIN_HEADERS = { authorization: "Bearer test-admin-secret" };

type AdminInfo = {
  docBytes: number;
  snapshots: number;
  lastSnapshotAt: number | null;
  text: string;
};

type SnapshotMeta = { id: number; createdAt: number; size: number };

/** Inspection reads persisted content, so it is the external view of storage. */
async function adminInfo(slug: string): Promise<AdminInfo> {
  const response = await SELF.fetch(roomUrl(slug, "?op=admin-info"), {
    headers: ADMIN_HEADERS,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as AdminInfo;
}

async function snapshotList(slug: string): Promise<SnapshotMeta[]> {
  const response = await SELF.fetch(roomUrl(slug, "?op=snapshots"));
  expect(response.status).toBe(200);
  return (await response.json()) as SnapshotMeta[];
}

/** Matches what the editor writes: paragraphs in the "document" XmlFragment. */
function appendParagraph(doc: Y.Doc, text: string): void {
  const fragment = doc.getXmlFragment("document");
  const paragraph = new Y.XmlElement("p");
  paragraph.insert(0, [new Y.XmlText(text)]);
  fragment.insert(fragment.length, [paragraph]);
}

const OVERSIZED_TEXT = "x".repeat(2 * 1024 * 1024);

/** Forces onLoad to run before runInDurableObject inspects the instance. */
async function warmRoom(slug: string) {
  const stub = env.PadRoom.getByName(slug);
  const response = await stub.fetch(roomUrl(slug, "?op=info"));
  await response.body?.cancel();
  return stub;
}

type RoomStub = Awaited<ReturnType<typeof warmRoom>>;

/**
 * The save hook cannot be reached over HTTP and a real Yjs client cannot push
 * a document past the 256KB message cap, so persistence is driven from inside
 * the Durable Object. Every assertion still runs through the Room interface.
 */
async function saveDocument(
  stub: RoomStub,
  edit?: (doc: Y.Doc) => void,
): Promise<void> {
  await runInDurableObject<PadRoom, void>(stub, async (instance) => {
    edit?.(instance.document);
    await instance.onSave();
  });
}

async function isFrozen(stub: RoomStub): Promise<boolean> {
  return runInDurableObject<PadRoom, boolean>(stub, (instance) => {
    const connection = {
      state: { readonly: false, ip: "" },
    } as unknown as Parameters<PadRoom["isReadOnly"]>[0];
    return instance.isReadOnly(connection);
  });
}

async function openRoomSocket(slug: string, query = ""): Promise<WebSocket> {
  const response = await SELF.fetch(
    new Request(roomUrl(slug, query), {
      headers: { Upgrade: "websocket" },
    }),
  );
  expect(response.status).toBe(101);
  expect(response.webSocket).not.toBeNull();
  const socket = response.webSocket!;
  socket.accept();
  return socket;
}

async function closeWithin(
  socket: WebSocket,
  timeoutMs = 20,
): Promise<number | null> {
  if (socket.readyState === WebSocket.CLOSED) return -1;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.addEventListener(
      "close",
      (event) => {
        clearTimeout(timer);
        resolve(event.code);
      },
      { once: true },
    );
  });
}

/** Closes every socket a test opened, whatever the assertions did. */
async function withSockets(
  body: (open: (query?: string) => Promise<WebSocket>) => Promise<void>,
  slug: string,
): Promise<void> {
  const sockets: WebSocket[] = [];
  try {
    await body(async (query = "") => {
      const socket = await openRoomSocket(slug, query);
      sockets.push(socket);
      return socket;
    });
  } finally {
    for (const socket of sockets) {
      if (socket.readyState < WebSocket.CLOSING) socket.close(1000);
    }
  }
}

const setPinRequest = (slug: string, body: unknown, token?: string) =>
  SELF.fetch(roomUrl(slug, `?op=set-pin${token ? `&token=${token}` : ""}`), {
    method: "POST",
    body: JSON.stringify(body),
  });

const verifyPinRequest = (slug: string, pin: string) =>
  SELF.fetch(roomUrl(slug, "?op=verify-pin"), {
    method: "POST",
    body: JSON.stringify({ pin }),
  });

const roTokenRequest = (
  slug: string,
  token?: string,
  method: "GET" | "POST" = "GET",
) =>
  SELF.fetch(roomUrl(slug, `?op=ro-token${token ? `&token=${token}` : ""}`), {
    method,
  });

/** Sets a PIN on a fresh pad and returns the session token that grants. */
async function protectPad(slug: string, pin = "1234"): Promise<string> {
  const response = await setPinRequest(slug, { pin });
  expect(response.status).toBe(200);
  return ((await response.json()) as { token: string }).token;
}

async function readOnlyToken(slug: string, token: string): Promise<string> {
  const response = await roTokenRequest(slug, token);
  expect(response.status).toBe(200);
  return ((await response.json()) as { token: string }).token;
}

describe("PadRoom HTTP interface", () => {
  it("conceals admin capabilities from unauthorized callers", async () => {
    const slug = uniqueSlug("admin-concealment");

    let response = await SELF.fetch(roomUrl(slug, "?op=admin-info"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "unknown-op" });

    response = await SELF.fetch(roomUrl(slug, "?op=admin-info"), {
      headers: { authorization: "Bearer wrong-secret" },
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "unknown-op" });
  });

  it("gives a blocked pad precedence over ordinary capabilities", async () => {
    const slug = uniqueSlug("admin-block");
    const adminHeaders = { authorization: "Bearer test-admin-secret" };

    let response = await SELF.fetch(roomUrl(slug, "?op=admin-block"), {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ reason: "characterization" }),
    });
    expect(response.status).toBe(200);
    const blocked = (await response.json()) as {
      ok: boolean;
      blocked: { reason?: string };
    };
    expect(blocked).toMatchObject({
      ok: true,
      blocked: { reason: "characterization" },
    });

    response = await SELF.fetch(roomUrl(slug, "?op=info"));
    await expect(response.json()).resolves.toEqual({
      pinProtected: false,
      removed: true,
    });

    response = await SELF.fetch(roomUrl(slug, "?op=set-pin"), {
      method: "POST",
      body: JSON.stringify({ pin: "1234" }),
    });
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: "pad-removed" });

    response = await SELF.fetch(roomUrl(slug, "?op=admin-unblock"), {
      method: "POST",
      headers: adminHeaders,
    });
    expect(response.status).toBe(200);

    response = await SELF.fetch(roomUrl(slug, "?op=info"));
    await expect(response.json()).resolves.toEqual({ pinProtected: false });
  });

  it("purges a pad and preserves an admin-requested block", async () => {
    const slug = uniqueSlug("admin-purge");
    const adminHeaders = { authorization: "Bearer test-admin-secret" };

    let response = await SELF.fetch(roomUrl(slug, "?op=set-pin"), {
      method: "POST",
      body: JSON.stringify({ pin: "1234" }),
    });
    expect(response.status).toBe(200);
    await response.body?.cancel();

    response = await SELF.fetch(roomUrl(slug, "?op=admin-purge"), {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ block: true, reason: "characterization" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, blocked: true });

    response = await SELF.fetch(roomUrl(slug, "?op=admin-info"), {
      headers: adminHeaders,
    });
    const info = (await response.json()) as {
      pinProtected: boolean;
      blocked: { reason?: string } | null;
      docBytes: number;
      snapshots: number;
    };
    expect(info).toMatchObject({
      pinProtected: false,
      blocked: { reason: "characterization" },
      docBytes: 0,
      snapshots: 0,
    });

    response = await SELF.fetch(roomUrl(slug, "?op=info"));
    await expect(response.json()).resolves.toEqual({
      pinProtected: false,
      removed: true,
    });
  });

  it("gates a protected pad and rotates read-only capabilities", async () => {
    const slug = uniqueSlug("auth");

    let response = await SELF.fetch(roomUrl(slug, "?op=info"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ pinProtected: false });

    response = await SELF.fetch(roomUrl(slug, "?op=set-pin"), {
      method: "POST",
      body: JSON.stringify({ pin: "1234" }),
    });
    expect(response.status).toBe(200);
    const { token } = (await response.json()) as { token: string };
    expect(token).toEqual(expect.any(String));

    response = await SELF.fetch(roomUrl(slug, "?op=ro-token"));
    expect(response.status).toBe(401);
    await response.body?.cancel();

    response = await SELF.fetch(
      roomUrl(slug, `?op=ro-token&token=${token}`),
    );
    const first = (await response.json()) as { token: string };
    expect(response.status).toBe(200);

    response = await SELF.fetch(
      roomUrl(slug, `?op=ro-token&token=${token}`),
      { method: "POST" },
    );
    const rotated = (await response.json()) as { token: string };
    expect(response.status).toBe(200);
    expect(rotated.token).not.toBe(first.token);
  });

  it("verifies and removes a PIN through the Room HTTP interface", async () => {
    const slug = uniqueSlug("pin-lifecycle");

    let response = await SELF.fetch(roomUrl(slug, "?op=set-pin"), {
      method: "POST",
      body: JSON.stringify({ pin: "1234" }),
    });
    const initial = (await response.json()) as { token: string };
    expect(response.status).toBe(200);

    response = await SELF.fetch(roomUrl(slug, "?op=verify-pin"), {
      method: "POST",
      body: JSON.stringify({ pin: "9999" }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "wrong-pin" });

    response = await SELF.fetch(roomUrl(slug, "?op=verify-pin"), {
      method: "POST",
      body: JSON.stringify({ pin: "1234" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      token: expect.any(String),
    });

    response = await SELF.fetch(
      roomUrl(slug, `?op=set-pin&token=${initial.token}`),
      {
        method: "POST",
        body: JSON.stringify({ remove: true }),
      },
    );
    expect(response.status).toBe(200);

    response = await SELF.fetch(roomUrl(slug, "?op=info"));
    await expect(response.json()).resolves.toEqual({ pinProtected: false });
  });

  it("rejects malformed PIN bodies without crashing the room", async () => {
    const slug = uniqueSlug("json");
    let response = await SELF.fetch(roomUrl(slug, "?op=set-pin"), {
      method: "POST",
      body: JSON.stringify({ pin: "1234" }),
    });
    await response.body?.cancel();

    response = await SELF.fetch(roomUrl(slug, "?op=verify-pin"), {
      method: "POST",
      body: "{not-json",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad-json" });
  });

  it("lists snapshot history and reports an absent snapshot", async () => {
    const slug = uniqueSlug("snapshot-http");

    let response = await SELF.fetch(roomUrl(slug, "?op=snapshots"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);

    response = await SELF.fetch(roomUrl(slug, "?op=restore"), {
      method: "POST",
      body: JSON.stringify({ id: 404 }),
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not-found" });
  });
});

/**
 * ADR-0005/0009 access credentials, characterized through the two transports
 * that consume them. Most of this was previously covered only by
 * scripts/api-smoke.mjs, which needs a running server; ADR-0011 puts room
 * invariants in the Workers-runtime suite. runInDurableObject appears only to
 * move a stored clock — the backoff window and a session's grant time — which
 * no external caller can advance. Nothing is seeded through it.
 */
describe("PadRoom access credentials", () => {
  it("refuses a WebSocket on a protected pad until a session is presented", async () => {
    const slug = uniqueSlug("pin-admission");
    const token = await protectPad(slug);

    await withSockets(async (open) => {
      // ADR-0005: the gate is server-side and closes before any document
      // bytes are sent, not a UI-side lock.
      expect(await closeWithin(await open(), 250)).toBe(4401);
      expect(await closeWithin(await open(`?token=${token}`))).toBeNull();
    }, slug);
  });

  it("invalidates sessions granted before a PIN change", async () => {
    const slug = uniqueSlug("pin-change");
    const first = await protectPad(slug);

    const response = await setPinRequest(slug, { pin: "5678" }, first);
    expect(response.status).toBe(200);
    const second = ((await response.json()) as { token: string }).token;
    expect(second).not.toBe(first);

    // The superseded session must lose both transports at once.
    expect((await roTokenRequest(slug, first)).status).toBe(401);
    expect((await roTokenRequest(slug, second)).status).toBe(200);

    await withSockets(async (open) => {
      expect(await closeWithin(await open(`?token=${first}`), 250)).toBe(4401);
      expect(await closeWithin(await open(`?token=${second}`))).toBeNull();
    }, slug);
  });

  it("reopens a pad when its PIN is removed", async () => {
    const slug = uniqueSlug("pin-removal");
    const token = await protectPad(slug);

    let response = await setPinRequest(slug, { remove: true });
    expect(response.status).toBe(401);
    await response.body?.cancel();

    response = await setPinRequest(slug, { remove: true }, token);
    expect(response.status).toBe(200);
    await response.body?.cancel();

    response = await SELF.fetch(roomUrl(slug, "?op=info"));
    await expect(response.json()).resolves.toEqual({ pinProtected: false });

    await withSockets(async (open) => {
      expect(await closeWithin(await open())).toBeNull();
    }, slug);

    // Removal also wipes the sessions it granted. That is not independently
    // observable here: with no PIN every caller may edit, and the only route
    // back to a protected pad — set-pin — wipes sessions itself.
  });

  it("accepts only PINs within the length rule, after trimming", async () => {
    const slug = uniqueSlug("pin-rule");

    let response = await setPinRequest(slug, { pin: "123" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid-pin" });

    response = await setPinRequest(slug, { pin: "x".repeat(65) });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid-pin" });

    // Surrounding whitespace is trimmed before the rule and before hashing,
    // so the trimmed form is what later verifies.
    response = await setPinRequest(slug, { pin: "  12345  " });
    expect(response.status).toBe(200);
    await response.body?.cancel();

    response = await verifyPinRequest(slug, "12345");
    expect(response.status).toBe(200);
    await response.body?.cancel();
  });

  it("throttles repeated PIN failures and clears the counter on success", async () => {
    const slug = uniqueSlug("pin-backoff");
    const stub = await warmRoom(slug);
    await protectPad(slug);

    // ADR-0009: five free attempts, then an exponential window.
    for (let attempt = 0; attempt < 5; attempt++) {
      const failure = await verifyPinRequest(slug, "9999");
      expect(failure.status).toBe(403);
      await failure.body?.cancel();
    }

    let response = await verifyPinRequest(slug, "1234");
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    const throttled = (await response.json()) as {
      error: string;
      retryInMs: number;
    };
    expect(throttled.error).toBe("too-many-attempts");
    expect(throttled.retryInMs).toBeGreaterThan(0);

    // The window is real wall-clock time this runtime will not advance, so
    // the stored failure timestamp is moved instead of waited out.
    await runInDurableObject<PadRoom, void>(stub, async (_instance, state) => {
      await state.storage.put("pinFails", { count: 5, lastAt: 0 });
    });

    response = await verifyPinRequest(slug, "1234");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ token: expect.any(String) });

    // Cleared, not merely aged out: the next wrong PIN is a plain rejection
    // rather than another throttle.
    response = await verifyPinRequest(slug, "9999");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "wrong-pin" });
  });

  it("stops honouring a session past its lifetime", async () => {
    const slug = uniqueSlug("session-ttl");
    const stub = await warmRoom(slug);
    const token = await protectPad(slug);

    expect((await roTokenRequest(slug, token)).status).toBe(200);

    // ADR-0009: 30 days from grant. Only the grant time is moved; the entry
    // itself was minted by the real code path.
    await runInDurableObject<PadRoom, void>(stub, async (_instance, state) => {
      const sessions =
        (await state.storage.get<Record<string, number>>("sessions")) ?? {};
      sessions[token] = Date.now() - 31 * 24 * 60 * 60 * 1000;
      await state.storage.put("sessions", sessions);
    });

    expect((await roTokenRequest(slug, token)).status).toBe(401);
    await withSockets(async (open) => {
      expect(await closeWithin(await open(`?token=${token}`), 250)).toBe(4401);
    }, slug);
  });

  it("mints one read-only token and replaces it only on rotation", async () => {
    const slug = uniqueSlug("ro-token-lifecycle");
    const token = await protectPad(slug);

    const first = await readOnlyToken(slug, token);
    expect(await readOnlyToken(slug, token)).toBe(first);

    const response = await roTokenRequest(slug, token, "POST");
    expect(response.status).toBe(200);
    const rotated = ((await response.json()) as { token: string }).token;
    expect(rotated).not.toBe(first);

    // A rotation is durable, not a one-off response value.
    expect(await readOnlyToken(slug, token)).toBe(rotated);
  });

  it("keeps live read-only sockets open across a rotation and refuses the old link", async () => {
    const slug = uniqueSlug("ro-rotation");
    const token = await protectPad(slug);
    const original = await readOnlyToken(slug, token);

    await withSockets(async (open) => {
      const live = await open(`?ro=${original}`);
      expect(await closeWithin(live)).toBeNull();

      const response = await roTokenRequest(slug, token, "POST");
      expect(response.status).toBe(200);
      const rotated = ((await response.json()) as { token: string }).token;

      // ADR-0009: rotation invalidates the link, not the sessions already
      // reading through it.
      expect(await closeWithin(live, 250)).toBeNull();
      expect(await closeWithin(await open(`?ro=${original}`), 250)).toBe(4403);
      expect(await closeWithin(await open(`?ro=${rotated}`))).toBeNull();
    }, slug);
  });

  it("fails closed on an unknown or never-minted read-only token", async () => {
    const known = uniqueSlug("ro-unknown");
    await protectPad(known);

    await withSockets(async (open) => {
      expect(await closeWithin(await open("?ro=not-a-real-token"), 250)).toBe(
        4403,
      );
    }, known);

    // A pad that has never minted a token refuses every one, rather than
    // treating "no token stored" as "nothing to check".
    const fresh = uniqueSlug("ro-never-minted");
    await withSockets(async (open) => {
      expect(await closeWithin(await open(`?ro=${crypto.randomUUID()}`), 250)).toBe(
        4403,
      );
    }, fresh);
  });

  it("wipes every access credential on purge", async () => {
    const slug = uniqueSlug("purge-credentials");
    const token = await protectPad(slug);
    const roToken = await readOnlyToken(slug, token);

    // Leave the backoff counter at the throttling threshold so its survival
    // would be visible below.
    for (let attempt = 0; attempt < 5; attempt++) {
      await (await verifyPinRequest(slug, "9999")).body?.cancel();
    }

    let response = await SELF.fetch(roomUrl(slug, "?op=admin-purge"), {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    await response.body?.cancel();

    response = await SELF.fetch(roomUrl(slug, "?op=info"));
    await expect(response.json()).resolves.toEqual({ pinProtected: false });

    await withSockets(async (open) => {
      // The read-only link is dead, and the unprotected pad admits an editor.
      expect(await closeWithin(await open(`?ro=${roToken}`), 250)).toBe(4403);
      expect(await closeWithin(await open())).toBeNull();
    }, slug);

    // The failure counter went too. Had it survived at the threshold, the
    // first wrong PIN under the new one would throttle instead of reject.
    await protectPad(slug, "5678");
    response = await verifyPinRequest(slug, "9999");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "wrong-pin" });
  });
});

describe("PadRoom eviction invariants", () => {
  it("preserves an over-cap freeze across eviction", async () => {
    const slug = uniqueSlug("eviction");
    const stub = await warmRoom(slug);

    // The fixture has to genuinely exceed the cap for the freeze to mean
    // anything, so assert that before relying on it.
    const oversized = new Y.Doc();
    appendParagraph(oversized, OVERSIZED_TEXT);
    expect(Y.encodeStateAsUpdate(oversized).byteLength).toBeGreaterThan(
      2 * 1024 * 1024,
    );

    await saveDocument(stub, (doc) => appendParagraph(doc, OVERSIZED_TEXT));
    // The freeze is asserted through the read-only decision rather than the
    // storage key, so it keeps holding once that key becomes private.
    expect(await isFrozen(stub)).toBe(true);

    await evictDurableObject(stub);
    await warmRoom(slug);

    expect(await isFrozen(stub)).toBe(true);
  });

  it("rehydrates a stored pad after eviction", async () => {
    const slug = uniqueSlug("rehydrate");
    const stub = await warmRoom(slug);

    await saveDocument(stub, (doc) => appendParagraph(doc, "first paragraph"));
    expect((await adminInfo(slug)).text).toContain("first paragraph");

    await evictDurableObject(stub);
    await warmRoom(slug);

    // Appending after eviction proves the reloaded room restored the stored
    // document: without it the earlier paragraph would be gone from storage.
    await saveDocument(stub, (doc) => appendParagraph(doc, "second paragraph"));

    const info = await adminInfo(slug);
    expect(info.text).toContain("first paragraph");
    expect(info.text).toContain("second paragraph");
  });
});

describe("PadRoom persisted pad state", () => {
  it("leaves an empty pad unpersisted", async () => {
    const slug = uniqueSlug("empty-pad");
    const stub = await warmRoom(slug);

    // ADR-0004: a room saved without a keystroke must mint nothing.
    await saveDocument(stub);

    const info = await adminInfo(slug);
    expect(info.docBytes).toBe(0);
    expect(info.snapshots).toBe(0);
    expect(info.lastSnapshotAt).toBeNull();
    await expect(snapshotList(slug)).resolves.toEqual([]);
  });

  it("takes one snapshot per idle interval, newest first", async () => {
    const slug = uniqueSlug("snapshot-cadence");
    const stub = await warmRoom(slug);

    await saveDocument(stub, (doc) => appendParagraph(doc, "first edit"));
    expect(await snapshotList(slug)).toHaveLength(1);

    // A second save inside the interval persists the document but must not
    // add history (ADR-0006).
    await saveDocument(stub, (doc) => appendParagraph(doc, "second edit"));
    expect(await snapshotList(slug)).toHaveLength(1);

    // Cadence is 60s of real time, which this runtime will not advance, so the
    // interval is moved rather than waited out.
    await runInDurableObject<PadRoom, void>(stub, async (_instance, state) => {
      await state.storage.put("lastSnapshotAt", Date.now() - 120_000);
    });
    await saveDocument(stub, (doc) => appendParagraph(doc, "third edit"));

    const snapshots = await snapshotList(slug);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].id).toBeGreaterThan(snapshots[1].id);
    expect(snapshots[0].size).toBeGreaterThan(snapshots[1].size);
    expect(snapshots[0].createdAt).toEqual(expect.any(Number));

    const info = await adminInfo(slug);
    expect(info.snapshots).toBe(2);
    expect(info.text).toContain("third edit");
  });

  it("keeps the newest 100 snapshots and prunes the oldest", async () => {
    const slug = uniqueSlug("snapshot-retention");
    const stub = await warmRoom(slug);

    await runInDurableObject<PadRoom, void>(stub, async (instance, state) => {
      for (let edit = 0; edit < 105; edit++) {
        appendParagraph(instance.document, `edit ${edit}`);
        // Clearing the cadence marker forces every save to snapshot.
        await state.storage.put("lastSnapshotAt", 0);
        await instance.onSave();
      }
    });

    const snapshots = await snapshotList(slug);
    expect(snapshots).toHaveLength(100);
    // Ordered newest first and contiguous, so exactly the oldest were pruned.
    expect(snapshots[0].id - snapshots[99].id).toBe(99);
    expect(snapshots[0].size).toBeGreaterThan(snapshots[99].size);
    expect((await adminInfo(slug)).snapshots).toBe(100);
  });

  it("keeps the last accepted document when a save exceeds the cap", async () => {
    const slug = uniqueSlug("over-cap-save");
    const stub = await warmRoom(slug);

    await saveDocument(stub, (doc) => appendParagraph(doc, "accepted content"));
    const accepted = await adminInfo(slug);
    expect(accepted.docBytes).toBeGreaterThan(0);

    await saveDocument(stub, (doc) => appendParagraph(doc, OVERSIZED_TEXT));
    expect(await isFrozen(stub)).toBe(true);

    // The over-cap update is refused outright: the last accepted document is
    // still what a reader or the operator gets.
    const frozen = await adminInfo(slug);
    expect(frozen.docBytes).toBe(accepted.docBytes);
    expect(frozen.text).toContain("accepted content");
    expect(frozen.text).not.toContain("x".repeat(1000));
  });

  it("recovers a frozen room by restoring a snapshot", async () => {
    const slug = uniqueSlug("frozen-restore");
    const stub = await warmRoom(slug);

    await saveDocument(stub, (doc) => appendParagraph(doc, "restorable content"));
    const [snapshot] = await snapshotList(slug);
    expect(snapshot).toBeDefined();

    await saveDocument(stub, (doc) => appendParagraph(doc, OVERSIZED_TEXT));
    expect(await isFrozen(stub)).toBe(true);

    const response = await SELF.fetch(roomUrl(slug, "?op=restore"), {
      method: "POST",
      body: JSON.stringify({ id: snapshot.id }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    // ADR-0006: an accepted restore is a new edit, and it is the recovery path
    // out of the document cap freeze.
    expect(await isFrozen(stub)).toBe(false);

    await saveDocument(stub);
    const restored = await adminInfo(slug);
    expect(restored.text).toContain("restorable content");
    expect(restored.text).not.toContain("x".repeat(1000));
    expect(restored.docBytes).toBeLessThan(2 * 1024 * 1024);
  });

  it("stops a warm room from re-persisting purged content", async () => {
    const slug = uniqueSlug("warm-purge");
    const stub = await warmRoom(slug);

    await saveDocument(stub, (doc) => appendParagraph(doc, "reported content"));
    expect((await adminInfo(slug)).text).toContain("reported content");

    const response = await SELF.fetch(roomUrl(slug, "?op=admin-purge"), {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, blocked: false });

    const purged = await adminInfo(slug);
    expect(purged.docBytes).toBe(0);
    expect(purged.snapshots).toBe(0);
    expect(purged.lastSnapshotAt).toBeNull();
    await expect(snapshotList(slug)).resolves.toEqual([]);

    // The room is still warm, so its next debounced save would write the live
    // document straight back if purge had not reset it. Yjs keeps deletion
    // metadata, so the invariant is that no content returns — not zero bytes.
    await saveDocument(stub);
    expect((await adminInfo(slug)).text).not.toContain("reported content");
  });
});

describe("Worker asset routing", () => {
  // This pins the Worker's behavior, not the routing that reaches it: SELF
  // .fetch invokes the entrypoint directly, so it would keep passing even if
  // wrangler.jsonc stopped sending /assets/* to the Worker — which is exactly
  // how the SPA-shell regression shipped. scripts/api-smoke.mjs covers the
  // routing against a real server.
  it("returns a non-cacheable 404 for a missing hashed asset", async () => {
    const response = await SELF.fetch(
      "https://padline.test/assets/not-a-real-build-chunk.js",
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("Not found");
  });
});

describe("Security headers", () => {
  // padline.test is not localhost, so this exercises the production branch of
  // withSecurityHeaders — the dev branch drops CSP and HSTS on purpose.
  it("sends CSP, HSTS and sniffing/referrer headers on a served response", async () => {
    const response = await SELF.fetch("https://padline.test/robots.txt");
    await response.body?.cancel();

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );

    const policy = response.headers.get("content-security-policy") ?? "";
    // form-action has no default-src fallback, so its absence would silently
    // leave submission targets open.
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("connect-src 'self' wss://padline.test");
  });

  it("omits CSP and HSTS on localhost so dev is not pinned to HTTPS", async () => {
    const response = await SELF.fetch("http://localhost/robots.txt");
    await response.body?.cancel();

    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("strict-transport-security")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("PadRoom connection invariants", () => {
  it("accepts exactly 50 room sockets and refuses the next one", async () => {
    const slug = uniqueSlug("connections");
    const sockets: WebSocket[] = [];

    try {
      for (let index = 0; index < 50; index++) {
        const socket = await openRoomSocket(slug);
        sockets.push(socket);
        expect(await closeWithin(socket)).toBeNull();
      }

      const overflow = await openRoomSocket(slug);
      sockets.push(overflow);
      expect(await closeWithin(overflow, 250)).toBe(1013);
    } finally {
      for (const socket of sockets) {
        if (socket.readyState < WebSocket.CLOSING) socket.close(1000);
      }
    }
  });
});
