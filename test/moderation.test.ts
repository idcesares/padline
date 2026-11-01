/// <reference types="vite/client" />
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { getServerByName } from "partyserver";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CLOSE, TEXT_KEY } from "../shared/limits";
import worker from "../worker/index";
import { resetJwksCache } from "../worker/access";
import type { PadRoom } from "../worker/pad-room";
import { type AccessKey, makeAccessKey, signJwt } from "./access-helpers";

const TEAM = "team.test.cloudflareaccess.com";
const ORIGIN = "https://padline.test";
const uniqueSlug = () => `t-${crypto.randomUUID().slice(0, 8)}`;

let key: AccessKey;
let token: string;

beforeAll(async () => {
  key = await makeAccessKey();
  token = await signJwt(key, {
    iss: `https://${TEAM}`,
    aud: ["test-aud"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: "op@example.com",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetJwksCache();
});

/** Serves the test key as the team's JWKS; every other fetch goes through. */
function serveJwks() {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new Request(input as RequestInfo).url;
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json(key.jwks);
    return real(input as RequestInfo, init);
  });
}

const admin = (path: string, init: RequestInit = {}, withToken = true) =>
  SELF.fetch(`${ORIGIN}/api/admin/${path}`, {
    ...init,
    headers: {
      ...(init.method === "POST"
        ? { "content-type": "application/json", origin: ORIGIN }
        : {}),
      ...(withToken ? { "cf-access-jwt-assertion": token } : {}),
    },
  });

const report = (body: unknown) =>
  SELF.fetch(`${ORIGIN}/api/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const room = (slug: string) => getServerByName(env.PadRoom as never, slug) as unknown as Promise<
  DurableObjectStub<PadRoom>
>;

/** Writes text into a room and runs the save, as a keystroke plus the debounce would. */
async function typeInto(slug: string, text: string) {
  const stub = await room(slug);
  await runInDurableObject(stub, async (instance: PadRoom) => {
    instance.document.getText(TEXT_KEY).insert(0, text);
    await instance.onSave();
  });
}

const padRow = (slug: string) =>
  env.DB.prepare("SELECT * FROM pads WHERE slug = ?").bind(slug).first<{
    size: number;
    edits: number;
    status: string;
  }>();

describe("public report", () => {
  it("answers the same for a pad that exists and one that does not", async () => {
    const real = uniqueSlug();
    await typeInto(real, "something");
    const a = await report({ slug: real, category: "spam" });
    const b = await report({ slug: uniqueSlug(), category: "spam" });
    expect(a.status).toBe(b.status);
    expect(await a.text()).toBe(await b.text());
  });

  it("stores no address, header or fingerprint", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(reports)").all<{ name: string }>();
    expect(results.map((c) => c.name).sort()).toEqual(
      ["category", "contact", "created", "id", "note", "resolved_at", "slug"].sort(),
    );
  });

  it("rejects an unknown category and an empty slug", async () => {
    expect((await report({ slug: "x", category: "nope" })).status).toBe(400);
    expect((await report({ slug: "", category: "spam" })).status).toBe(400);
  });

  it("accepts a reserved address with the same answer but stores nothing", async () => {
    const response = await report({ slug: "admin", category: "spam" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const row = await env.DB.prepare("SELECT id FROM reports WHERE slug = 'admin'").first();
    expect(row).toBeNull();
  });

  it("caps the note", async () => {
    const slug = uniqueSlug();
    await report({ slug, category: "other", note: "a".repeat(1000) });
    const row = await env.DB.prepare("SELECT note FROM reports WHERE slug = ?")
      .bind(slug)
      .first<{ note: string }>();
    expect(row!.note.length).toBe(280);
  });
});

describe("admin access", () => {
  it("answers 401 without an assertion", async () => {
    serveJwks();
    expect((await admin("pads", {}, false)).status).toBe(401);
    const shell = await SELF.fetch(`${ORIGIN}/admin`);
    expect(shell.status).toBe(401);
  });

  it("answers 401 for an assertion signed by another key", async () => {
    serveJwks();
    const other = await makeAccessKey();
    const forged = await signJwt(other, {
      iss: `https://${TEAM}`,
      aud: ["test-aud"],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const response = await SELF.fetch(`${ORIGIN}/api/admin/pads`, {
      headers: { "cf-access-jwt-assertion": forged },
    });
    expect(response.status).toBe(401);
  });

  it("fails closed when Access is not configured", async () => {
    const bare = { ...env, ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" };
    const response = await worker.fetch(
      new Request(`${ORIGIN}/api/admin/pads`, {
        headers: { "cf-access-jwt-assertion": token },
      }),
      bare,
    );
    expect(response.status).toBe(403);
  });

  it("ignores the dev bypass off localhost", async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/api/admin/pads`),
      { ...env, ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "", ADMIN_DEV_BYPASS: "1" },
    );
    expect(response.status).toBe(403);
  });

  it("lets a valid assertion read the index", async () => {
    serveJwks();
    const response = await admin("pads");
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("pads");
  });

  it("refuses a state change from another origin", async () => {
    serveJwks();
    const response = await SELF.fetch(`${ORIGIN}/api/admin/pads/${uniqueSlug()}/dismiss`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        "cf-access-jwt-assertion": token,
      },
    });
    expect(response.status).toBe(403);
  });
});

describe("pad index", () => {
  it("creates no row for a room nobody typed in", async () => {
    const slug = uniqueSlug();
    const response = await SELF.fetch(`${ORIGIN}/parties/pad-room/${slug}`, {
      headers: { Upgrade: "websocket" },
    });
    response.webSocket!.accept();
    await new Promise((r) => setTimeout(r, 150));
    response.webSocket!.close();
    expect(await padRow(slug)).toBeNull();
  });

  it("inserts on the first save and throttles the next to an alarm", async () => {
    const slug = uniqueSlug();
    await typeInto(slug, "one");
    expect((await padRow(slug))?.edits).toBe(1);

    await typeInto(slug, " two");
    expect((await padRow(slug))?.edits).toBe(1);
    const stub = await room(slug);
    const alarm = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(alarm).not.toBeNull();
  });
});

describe("operator actions", () => {
  it("clear leaves the pad open with empty text and logs it", async () => {
    serveJwks();
    const slug = uniqueSlug();
    await typeInto(slug, "to be removed");
    const response = await admin(`pads/${slug}/clear`, { method: "POST" });
    expect(response.status).toBe(200);

    const stub = await room(slug);
    const state = await stub.adminExcerpt();
    expect(state.length).toBe(0);
    expect((await padRow(slug))?.status).toBe("emptied");
    const log = await env.DB.prepare("SELECT action, slug FROM actions WHERE slug = ?")
      .bind(slug)
      .all();
    expect(log.results).toEqual([{ action: "clear", slug }]);
  });

  it("an emptied pad stays emptied through an index flush until someone writes again", async () => {
    serveJwks();
    const slug = uniqueSlug();
    await typeInto(slug, "to be removed");
    await admin(`pads/${slug}/clear`, { method: "POST" });
    const stub = await room(slug);
    await runInDurableObject(stub, (instance: PadRoom) => instance.onAlarm());
    expect((await padRow(slug))?.status).toBe("emptied");

    await typeInto(slug, "fresh");
    await runInDurableObject(stub, (instance: PadRoom) => instance.onAlarm());
    expect((await padRow(slug))?.status).toBe("live");
  });

  it("block closes open sockets with 4404 and exposes only the category", async () => {
    serveJwks();
    const slug = uniqueSlug();
    await typeInto(slug, "bad text");
    const socket = await SELF.fetch(`${ORIGIN}/parties/pad-room/${slug}`, {
      headers: { Upgrade: "websocket" },
    });
    const ws = socket.webSocket!;
    ws.accept();
    const closed = new Promise<CloseEvent>((resolve) =>
      ws.addEventListener("close", (e) => resolve(e as CloseEvent)),
    );

    const blocked = await admin(`pads/${slug}/block`, {
      method: "POST",
      body: JSON.stringify({ category: "scam" }),
    });
    expect(blocked.status).toBe(200);
    expect((await closed).code).toBe(CLOSE.removed);

    const status = await SELF.fetch(`${ORIGIN}/parties/pad-room/${slug}?op=status`);
    const body = (await status.json()) as { removed: { at: number; category: string } };
    expect(body.removed.category).toBe("scam");
    expect(Object.keys(body.removed).sort()).toEqual(["at", "category"]);
    expect((await padRow(slug))?.status).toBe("blocked");

    // A new visitor is refused, and the stored text is gone.
    const again = await SELF.fetch(`${ORIGIN}/parties/pad-room/${slug}`, {
      headers: { Upgrade: "websocket" },
    });
    again.webSocket!.accept();
    const refused = await new Promise<CloseEvent>((resolve) =>
      again.webSocket!.addEventListener("close", (e) => resolve(e as CloseEvent)),
    );
    expect(refused.code).toBe(CLOSE.removed);
    const stub = await room(slug);
    const kept = await runInDurableObject(stub, (_i, state) => state.storage.get("doc"));
    expect(kept).toBeUndefined();
  });

  it("clear on a blocked pad is refused and leaves the status and the log alone", async () => {
    serveJwks();
    const slug = uniqueSlug();
    await admin(`pads/${slug}/block`, { method: "POST", body: JSON.stringify({ category: "spam" }) });
    const response = await admin(`pads/${slug}/clear`, { method: "POST" });
    expect(response.status).toBe(409);
    expect((await padRow(slug))?.status).toBe("blocked");
    const log = await env.DB.prepare("SELECT action FROM actions WHERE slug = ?").bind(slug).all();
    expect(log.results).toEqual([{ action: "block" }]);
  });

  it("block works on a slug the index has never seen", async () => {
    serveJwks();
    const slug = uniqueSlug();
    const blocked = await admin(`pads/${slug}/block`, {
      method: "POST",
      body: JSON.stringify({ category: "spam" }),
    });
    expect(blocked.status).toBe(200);
    expect((await padRow(slug))?.status).toBe("blocked");
  });

  it("a second block keeps the first record and adds nothing to the log", async () => {
    serveJwks();
    const slug = uniqueSlug();
    await admin(`pads/${slug}/block`, { method: "POST", body: JSON.stringify({ category: "scam" }) });
    const again = await admin(`pads/${slug}/block`, {
      method: "POST",
      body: JSON.stringify({ category: "spam" }),
    });
    expect(again.status).toBe(409);
    const status = await SELF.fetch(`${ORIGIN}/parties/pad-room/${slug}?op=status`);
    const body = (await status.json()) as { removed: { category: string } };
    expect(body.removed.category).toBe("scam");
    const log = await env.DB.prepare("SELECT action FROM actions WHERE slug = ?").bind(slug).all();
    expect(log.results).toEqual([{ action: "block" }]);
  });

  it("clear on a slug the index has never seen is a 404 and logs nothing", async () => {
    serveJwks();
    const slug = uniqueSlug();
    const response = await admin(`pads/${slug}/clear`, { method: "POST" });
    expect(response.status).toBe(404);
    expect(await padRow(slug)).toBeNull();
    const log = await env.DB.prepare("SELECT action FROM actions WHERE slug = ?").bind(slug).all();
    expect(log.results).toEqual([]);
  });

  it("a malformed percent-escape in the path is a 400, not a 503", async () => {
    serveJwks();
    const response = await admin("pads/%E0%A4%A", { method: "POST" });
    expect(response.status).toBe(400);
  });

  it("dismiss resolves the open reports", async () => {
    serveJwks();
    const slug = uniqueSlug();
    await report({ slug, category: "other" });
    const before = await (await admin("pads?filter=reported")).json<{ pads: { slug: string }[] }>();
    expect(before.pads.some((p) => p.slug === slug)).toBe(true);

    await admin(`pads/${slug}/dismiss`, { method: "POST" });
    const after = await (await admin("pads?filter=reported")).json<{ pads: { slug: string }[] }>();
    expect(after.pads.some((p) => p.slug === slug)).toBe(false);
  });

  it("rejects a block without a category from the list", async () => {
    serveJwks();
    const response = await admin(`pads/${uniqueSlug()}/block`, {
      method: "POST",
      body: JSON.stringify({ category: "because" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("invariants in the source", () => {
  const sources = import.meta.glob("../worker/*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;
  const migrations = import.meta.glob("../migrations/*.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  it("never updates or deletes an actions row", () => {
    const all = [...Object.values(sources), ...Object.values(migrations)].join("\n");
    expect(all).not.toMatch(/UPDATE\s+actions/i);
    expect(all).not.toMatch(/DELETE\s+FROM\s+actions/i);
    expect(all).not.toMatch(/DROP\s+TABLE\s+actions/i);
  });

  it("never reads a request address or Cloudflare header in the report path", () => {
    expect(sources["../worker/moderation.ts"]).not.toMatch(/cf-connecting-ip|x-forwarded-for|request\.cf/i);
  });
});
