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

async function openRoomSocket(slug: string): Promise<WebSocket> {
  const response = await SELF.fetch(
    new Request(roomUrl(slug), {
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

describe("PadRoom HTTP interface", () => {
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
});

describe("PadRoom eviction invariants", () => {
  it("preserves an over-cap freeze across eviction", async () => {
    const slug = uniqueSlug("eviction");
    const stub = env.PadRoom.getByName(slug);

    let response = await stub.fetch(roomUrl(slug, "?op=info"));
    await response.body?.cancel();

    const oversized = new Y.Doc();
    oversized.getText("document").insert(0, "x".repeat(2 * 1024 * 1024));
    const update = Y.encodeStateAsUpdate(oversized);
    expect(update.byteLength).toBeGreaterThan(2 * 1024 * 1024);

    await runInDurableObject<PadRoom, void>(stub, async (instance, state) => {
      Y.applyUpdate(instance.document, update);
      await instance.onSave();
      await expect(state.storage.get("docOverCap")).resolves.toBe(true);
    });
    await evictDurableObject(stub);

    response = await stub.fetch(roomUrl(slug, "?op=info"));
    await response.body?.cancel();

    const readOnly = await runInDurableObject<PadRoom, boolean>(
      stub,
      (instance) => {
        const connection = {
          state: { readonly: false, ip: "" },
        } as unknown as Parameters<PadRoom["isReadOnly"]>[0];
        return instance.isReadOnly(connection);
      },
    );
    expect(readOnly).toBe(true);
  });
});

describe("Worker asset routing", () => {
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
