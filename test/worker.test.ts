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
