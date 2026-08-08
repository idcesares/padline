import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * The pad has connected to its Room.
 *
 * The sync indicator lives in the status line by default; the header falls back
 * to a labelled dot only while the status line is switched off. Both expose
 * `role="status"`, so this holds either way.
 */
const expectConnected = (page: Page, options?: { timeout?: number }) =>
  expect(
    page.getByRole("status").filter({ hasText: "Synced" }),
  ).toBeVisible(options);

const uniqueSlug = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function readDevVar(name: string): string | undefined {
  try {
    const line = readFileSync(".dev.vars", "utf8")
      .split(/\r?\n/)
      .find((candidate) => candidate.trimStart().startsWith(`${name}=`));
    if (!line) return undefined;
    return line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
  } catch {
    return undefined;
  }
}

const adminSecret = process.env.ADMIN_SECRET ?? readDevVar("ADMIN_SECRET");

const roomPath = (slug: string, query: string) =>
  `/parties/pad-room/${slug}?${query}`;

async function setPin(
  request: APIRequestContext,
  slug: string,
  pin = "1234",
): Promise<string> {
  const response = await request.post(roomPath(slug, "op=set-pin"), {
    data: { pin },
  });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { token: string }).token;
}

test.describe("pad session route", () => {
  test("opens a fresh pad as an editable Room session", async ({ page }) => {
    const slug = uniqueSlug("fresh");
    const openedAt = Date.now();

    await page.goto(`/${slug}`);

    await expect(page).toHaveTitle(`/${slug} — Padline`);
    await expect(page.getByRole("button", { name: "Share this pad" })).toBeVisible();
    await expectConnected(page);
    await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "false", {
      timeout: 3_500,
    });
    expect(Date.now() - openedAt).toBeLessThan(3_500);
    await expect(page.getByText("View only", { exact: true })).toHaveCount(0);
  });

  test("grants and persists a protected pad session after PIN verification", async ({
    page,
    request,
  }) => {
    const slug = uniqueSlug("pin");
    await setPin(request, slug);

    await page.goto(`/${slug}`);
    await expect(
      page.getByRole("heading", { name: "This pad is protected" }),
    ).toBeVisible();

    await page.getByPlaceholder("PIN").fill("1234");
    await page.getByRole("button", { name: "Open pad" }).click();

    await expect(page.getByRole("button", { name: "Share this pad" })).toBeVisible();
    await expectConnected(page);
    const storedToken = await page.evaluate(
      (key) => localStorage.getItem(key),
      `padline:token:${slug}`,
    );
    expect(storedToken).toEqual(expect.any(String));
  });

  test("reconnects with the current session after adding PIN protection", async ({
    page,
  }) => {
    const slug = uniqueSlug("reconnect");
    await page.addInitScript(() => {
      const roomSockets: WebSocket[] = [];
      Object.defineProperty(window, "__padlineRoomSockets", {
        value: roomSockets,
      });
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          if (protocols === undefined) super(url);
          else super(url, protocols);
          if (String(url).includes("/pad-room/")) roomSockets.push(this);
        }
      };
    });
    await page.goto(`/${slug}`);
    await expectConnected(page);

    await page.getByRole("button", { name: "Share this pad" }).click();
    await page.getByPlaceholder("Choose a PIN (min. 4 characters)").fill("1234");
    await page.getByRole("button", { name: "Set", exact: true }).click();
    await expect(page.getByText("This pad requires a PIN")).toBeVisible();

    // Close the share dialog: while it is open Radix marks the rest of the page
    // aria-hidden, so the status line is absent from the accessibility tree.
    await page.keyboard.press("Escape");
    await expect(page.getByText("This pad requires a PIN")).toHaveCount(0);

    await page.evaluate(() => {
      const sockets = (
        window as Window & { __padlineRoomSockets: WebSocket[] }
      ).__padlineRoomSockets;
      sockets[sockets.length - 1]?.close(4000, "test-reconnect");
    });
    await expect
      .poll(() => {
        return page.evaluate(
          () =>
            (
              window as Window & { __padlineRoomSockets: WebSocket[] }
            ).__padlineRoomSockets.length,
        );
      })
      .toBeGreaterThan(1);

    await expectConnected(page, { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: "This pad is protected" }),
    ).toHaveCount(0);
  });

  test("clears a rejected stored session and returns to the PIN prompt", async ({
    page,
    request,
  }) => {
    const slug = uniqueSlug("expired");
    await setPin(request, slug);
    await page.addInitScript(
      ({ key }) => localStorage.setItem(key, "expired-session"),
      { key: `padline:token:${slug}` },
    );

    await page.goto(`/${slug}`);

    await expect(
      page.getByRole("heading", { name: "This pad is protected" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          (key) => localStorage.getItem(key),
          `padline:token:${slug}`,
        ),
      )
      .toBeNull();
  });

  test("opens a read-only link without exposing edit capabilities", async ({
    page,
    request,
  }) => {
    const slug = uniqueSlug("readonly");
    const token = await setPin(request, slug);
    const response = await request.get(
      roomPath(slug, `op=ro-token&token=${encodeURIComponent(token)}`),
    );
    expect(response.ok()).toBeTruthy();
    const { token: readOnlyToken } = (await response.json()) as { token: string };

    await page.goto(`/${slug}?v=${encodeURIComponent(readOnlyToken)}`);

    await expect(page.getByText("View only", { exact: true })).toBeVisible();
    await expectConnected(page);
    await expect(page.getByRole("button", { name: "Share this pad" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Document history" })).toHaveCount(0);
  });

  test("renders cached pad content before the Room can reconnect", async ({
    context,
    page,
  }) => {
    const slug = uniqueSlug("cached");
    const cachedText = `cached ${slug}`;
    await page.goto(`/${slug}`);
    await expectConnected(page);
    await page.getByRole("textbox").fill(cachedText);
    await expect(page.getByText(cachedText, { exact: true })).toBeVisible();
    await page.waitForTimeout(250);

    await page.getByRole("link", { name: "Padline" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Padline" })).toBeVisible();
    await context.setOffline(true);

    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(`/${slug}`);
    await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "false", {
      timeout: 2_000,
    });
    await expect(page.getByText(cachedText, { exact: true })).toBeVisible();
  });

  test("reveals an uncached pad after the offline readiness fallback", async ({
    context,
    page,
  }) => {
    const warmSlug = uniqueSlug("warm");
    await page.goto(`/${warmSlug}`);
    await expectConnected(page);
    await page.getByRole("link", { name: "Padline" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Padline" })).toBeVisible();

    const uncachedSlug = uniqueSlug("uncached");
    await context.setOffline(true);
    const startedAt = Date.now();
    await page.evaluate((path) => {
      history.pushState(null, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, `/${uncachedSlug}`);
    await expect(page).toHaveURL(`/${uncachedSlug}`);
    await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "false", {
      timeout: 6_000,
    });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(3_500);
  });

  test("renders the takedown notice when a connected pad is blocked", async ({
    page,
    request,
  }) => {
    test.skip(!adminSecret, "ADMIN_SECRET or .dev.vars is required");
    const slug = uniqueSlug("removed");
    const headers = { authorization: `Bearer ${adminSecret}` };

    try {
      await page.goto(`/${slug}`);
      await expectConnected(page);
      const block = await request.post(roomPath(slug, "op=admin-block"), {
        headers,
        data: { reason: "browser characterization" },
      });
      expect(block.ok()).toBeTruthy();
      await expect(
        page.getByRole("heading", { name: "This pad was removed" }),
      ).toBeVisible();
    } finally {
      await request.post(roomPath(slug, "op=admin-unblock"), { headers });
    }
  });
});
