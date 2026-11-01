import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CLOSE } from "../shared/limits";

const roomUrl = (slug: string, query = "") =>
  `https://padline.test/parties/pad-room/${slug}${query}`;

const uniqueSlug = () => `t-${crypto.randomUUID().slice(0, 8)}`;

/** Opens a WebSocket to a room and resolves with the first close event, or null if it stays open. */
async function connect(slug: string) {
  const response = await SELF.fetch(roomUrl(slug), { headers: { Upgrade: "websocket" } });
  expect(response.status).toBe(101);
  const ws = response.webSocket!;
  ws.accept();
  const closed = new Promise<CloseEvent | null>((resolve) => {
    ws.addEventListener("close", (e) => resolve(e as CloseEvent));
    setTimeout(() => resolve(null), 400);
  });
  return { ws, closed };
}

describe("room connections", () => {
  it("keeps a valid slug connected", async () => {
    const { ws, closed } = await connect(uniqueSlug());
    expect(await closed).toBeNull();
    ws.close();
  });

  it("closes an invalid slug with 4400", async () => {
    const { closed } = await connect("Not_A_Slug");
    expect((await closed)?.code).toBe(CLOSE.invalidSlug);
  });

  it("closes a reserved slug with 4400", async () => {
    const { closed } = await connect("admin");
    expect((await closed)?.code).toBe(CLOSE.invalidSlug);
  });
});

describe("room status", () => {
  it("reports a normal pad as not removed", async () => {
    const response = await SELF.fetch(roomUrl(uniqueSlug(), "?op=status"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: null });
  });

  it("never exposes admin ops on the public route", async () => {
    const response = await SELF.fetch(roomUrl(uniqueSlug(), "?op=admin-info"));
    expect(response.status).toBe(404);
  });
});
