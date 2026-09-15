import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  MODERATION_PROFILE,
  isReportCategory,
  priorityOf,
} from "../src/lib/moderation-profile";
import type { ModerationLedger, PadRoom } from "../worker";
import { isAdminRequest } from "../worker/admin-auth";
import { actionHash } from "../worker/moderation-ledger";
import type {
  ActionRecord,
  CaseRecord,
  ChainVerification,
  EvidenceRecord,
  ReportRecord,
} from "../worker/moderation-ledger";

const ADMIN_HEADERS = { authorization: "Bearer test-admin-secret" };

const adminUrl = (path: string) => `https://padline.test/api/admin${path}`;

const uniqueSlug = (prefix: string) =>
  `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

type OpenedCase = { case: CaseRecord; created: boolean; reportId: number };
type CaseTimeline = {
  case: CaseRecord;
  reports: ReportRecord[];
  actions: ActionRecord[];
};

function openCase(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(adminUrl("/cases"), {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ kind: "violation", source: "email", ...body }),
  });
}

async function openedCase(body: Record<string, unknown>): Promise<OpenedCase> {
  const response = await openCase(body);
  expect(response.status).toBeLessThan(300);
  return (await response.json()) as OpenedCase;
}

async function adminGet<T>(path: string): Promise<T> {
  const response = await SELF.fetch(adminUrl(path), { headers: ADMIN_HEADERS });
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

describe("Moderation profile", () => {
  it("holds well-formed, stable values", () => {
    const ids = Object.keys(MODERATION_PROFILE.categories);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    }
    expect(ids.some((id) => isReportCategory(id) && priorityOf(id) === "grave")).toBe(true);

    for (const value of [
      MODERATION_PROFILE.reviewTargetHours.grave,
      MODERATION_PROFILE.reviewTargetHours.standard,
      MODERATION_PROFILE.evidenceRetentionDays,
      MODERATION_PROFILE.reporterContactRetentionDays,
    ]) {
      expect(Number.isInteger(value) && value > 0).toBe(true);
    }
  });

  it("recognizes only its own category ids", () => {
    expect(isReportCategory("phishing-malware")).toBe(true);
    expect(isReportCategory("toString")).toBe(false);
    expect(isReportCategory("")).toBe(false);
    expect(isReportCategory(42)).toBe(false);
  });
});

describe("Admin secret", () => {
  it("fails closed with no secret deployed or an empty bearer", async () => {
    const request = (authorization?: string) =>
      new Request("https://padline.test/api/admin/cases", {
        headers: authorization ? { authorization } : undefined,
      });

    await expect(isAdminRequest(request("Bearer anything"), undefined)).resolves.toBe(false);
    await expect(isAdminRequest(request("Bearer anything"), "")).resolves.toBe(false);
    await expect(isAdminRequest(request("Bearer "), "secret")).resolves.toBe(false);
    await expect(isAdminRequest(request(), "secret")).resolves.toBe(false);
    await expect(isAdminRequest(request("secret"), "secret")).resolves.toBe(false);
    await expect(isAdminRequest(request("Bearer secret-longer"), "secret")).resolves.toBe(false);
    await expect(isAdminRequest(request("Bearer secret"), "secret")).resolves.toBe(true);
  });
});

describe("Moderation ledger", () => {
  it("conceals itself from unauthorized callers", async () => {
    const unauthorized: HeadersInit[] = [{}, { authorization: "Bearer wrong-secret" }];
    for (const headers of unauthorized) {
      const response = await SELF.fetch(adminUrl("/cases"), { headers });
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "unknown-op" });
    }

    const response = await SELF.fetch(adminUrl("/not-a-route"), {
      headers: ADMIN_HEADERS,
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "unknown-op" });
  });

  it("opens one case per slug and kind and attaches later notices to it", async () => {
    const slug = uniqueSlug("ledger-case");

    const first = await openedCase({ slug, category: "spam", description: "link farm" });
    expect(first.created).toBe(true);
    expect(first.case).toMatchObject({
      slug,
      kind: "violation",
      category: "spam",
      priority: "standard",
      status: "open",
      reports: 1,
    });

    let response = await openCase({ slug, category: "phishing-malware" });
    expect(response.status).toBe(200);
    const second = (await response.json()) as OpenedCase;
    expect(second.created).toBe(false);
    expect(second.case.id).toBe(first.case.id);
    expect(second.case.reports).toBe(2);

    response = await openCase({ slug, kind: "removal-request", category: "privacy" });
    expect(response.status).toBe(201);
    const removal = (await response.json()) as OpenedCase;
    expect(removal.case.id).not.toBe(first.case.id);

    const timeline = await adminGet<CaseTimeline>(`/cases/${first.case.id}`);
    expect(timeline.reports.map((report) => report.category)).toEqual([
      "spam",
      "phishing-malware",
    ]);
    expect(timeline.reports[0]).toMatchObject({
      source: "email",
      description: "link farm",
      contact: null,
    });
    expect(timeline.actions.map((action) => action.action)).toEqual([
      "case-opened",
      "notice-attached",
    ]);
  });

  it("raises a case to grave and never lowers it", async () => {
    const slug = uniqueSlug("ledger-grave");

    await openedCase({ slug, category: "other" });
    const raised = await openedCase({ slug, category: "terrorism" });
    expect(raised.case.priority).toBe("grave");

    const after = await openedCase({ slug, category: "spam" });
    expect(after.case.priority).toBe("grave");
    // The case keeps the category it was opened with; each notice keeps its own.
    expect(after.case.category).toBe("other");
  });

  it("lists grave cases before standard ones, oldest first", async () => {
    const standard = uniqueSlug("ledger-order-standard");
    const grave = uniqueSlug("ledger-order-grave");
    const olderStandard = await openedCase({ slug: standard, category: "copyright" });
    const newerGrave = await openedCase({ slug: grave, category: "human-trafficking" });

    const { cases } = await adminGet<{ cases: CaseRecord[] }>("/cases?status=open");
    const ours = cases
      .map((entry) => entry.id)
      .filter((id) => id === olderStandard.case.id || id === newerGrave.case.id);
    expect(ours).toEqual([newerGrave.case.id, olderStandard.case.id]);

    const filtered = await adminGet<{ cases: CaseRecord[] }>(`/cases?slug=${grave}`);
    expect(filtered.cases.map((entry) => entry.id)).toEqual([newerGrave.case.id]);
  });

  it("refuses malformed notices without recording them", async () => {
    const slug = uniqueSlug("ledger-invalid");
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ slug: "api", category: "spam" }, "invalid-slug"],
      [{ slug: "Not A Slug", category: "spam" }, "invalid-slug"],
      [{ slug, category: "not-a-category" }, "invalid-category"],
      [{ slug, category: "spam", kind: "complaint" }, "invalid-kind"],
      [{ slug, category: "spam", source: "carrier-pigeon" }, "invalid-source"],
      [{ slug, category: "spam", description: "x".repeat(2001) }, "invalid-description"],
      [{ slug, category: "spam", contact: 42 }, "invalid-contact"],
    ];
    for (const [body, error] of cases) {
      const response = await openCase(body);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error });
    }

    const response = await SELF.fetch(adminUrl("/cases"), {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: "{not-json",
    });
    expect(response.status).toBe(400);

    const { cases: recorded } = await adminGet<{ cases: CaseRecord[] }>(
      `/cases?slug=${slug}`,
    );
    expect(recorded).toEqual([]);
  });

  it("chains the action log and detects a rewritten row", async () => {
    await openedCase({ slug: uniqueSlug("ledger-chain"), category: "spam" });

    const intact = await adminGet<ChainVerification>("/actions/verify");
    expect(intact.ok).toBe(true);
    expect(intact.count).toBeGreaterThan(0);

    // Moving stored state is the only way to prove detection: no interface
    // rewrites the log. The original value is restored so later tests see an
    // intact chain.
    const ledger = env.ModerationLedger.getByName("ledger");
    const tamper = (reason: string | null) =>
      runInDurableObject<ModerationLedger, void>(ledger, (_instance, state) => {
        state.storage.sql.exec("UPDATE actions SET reason = ? WHERE seq = 1", reason);
      });
    const original = await runInDurableObject<ModerationLedger, string | null>(
      ledger,
      (_instance, state) =>
        state.storage.sql.exec("SELECT reason FROM actions WHERE seq = 1").one()
          .reason as string | null,
    );

    try {
      await tamper("rewritten after the fact");
      const broken = await adminGet<ChainVerification>("/actions/verify");
      expect(broken).toMatchObject({ ok: false, brokenAt: 1 });
    } finally {
      await tamper(original);
    }
    await expect(adminGet<ChainVerification>("/actions/verify")).resolves.toMatchObject({
      ok: true,
    });
  });
});

const roomUrl = (slug: string, query = "") =>
  `https://padline.test/parties/pad-room/${slug}${query}`;

type ActResponse = {
  case?: CaseRecord;
  actions: ActionRecord[];
  result?: Record<string, unknown>;
  error?: string;
};

function act(caseId: number, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(adminUrl(`/cases/${caseId}/actions`), {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify(body),
  });
}

async function publicInfo(slug: string): Promise<unknown> {
  const response = await SELF.fetch(roomUrl(slug, "?op=info"));
  return response.json();
}

/** Persists a paragraph the way the editor would; the save hook has no HTTP path. */
async function writePad(slug: string, text: string): Promise<void> {
  const stub = env.PadRoom.getByName(slug);
  const warm = await stub.fetch(roomUrl(slug, "?op=info"));
  await warm.body?.cancel();
  await runInDurableObject<PadRoom, void>(stub, async (instance) => {
    const paragraph = new Y.XmlElement("p");
    paragraph.insert(0, [new Y.XmlText(text)]);
    const fragment = instance.document.getXmlFragment("document");
    fragment.insert(fragment.length, [paragraph]);
    await instance.onSave();
  });
}

describe("Moderation ledger takedowns", () => {
  it("keeps room admin ops off the public route, even with the secret", async () => {
    const slug = uniqueSlug("ledger-public-route");
    const ops: Array<[string, string]> = [
      ["admin-info", "GET"],
      ["admin-block", "POST"],
      ["admin-unblock", "POST"],
      ["admin-purge", "POST"],
    ];
    for (const [op, method] of ops) {
      const response = await SELF.fetch(roomUrl(slug, `?op=${op}`), {
        method,
        headers: ADMIN_HEADERS,
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "unknown-op" });
    }
    await expect(publicInfo(slug)).resolves.toEqual({ pinProtected: false });
  });

  it("reviews a case through the room and keeps content out of the log", async () => {
    const slug = uniqueSlug("ledger-review");
    await writePad(slug, "reported paragraph");
    const { case: opened } = await openedCase({ slug, category: "harassment-doxxing" });

    const response = await act(opened.id, { action: "review" });
    expect(response.status).toBe(200);
    const reviewed = (await response.json()) as ActResponse;

    expect(String(reviewed.result?.text)).toContain("reported paragraph");
    expect(reviewed.actions.map((entry) => [entry.action, entry.outcome])).toEqual([
      ["review", "pending"],
      ["review", "ok"],
    ]);
    expect(reviewed.actions[1].paramsJson).not.toContain("reported paragraph");
    expect(JSON.parse(reviewed.actions[1].paramsJson)).toMatchObject({
      intent: reviewed.actions[0].seq,
      result: { textChars: expect.any(Number) },
    });
    expect(reviewed.case).toMatchObject({
      status: "reviewing",
      firstReviewedAt: expect.any(Number),
    });
  });

  it("blocks, unblocks, and purges only with a reason, recording each step", async () => {
    const slug = uniqueSlug("ledger-takedown");
    await writePad(slug, "content to remove");
    const { case: opened } = await openedCase({ slug, category: "phishing-malware" });

    let response = await act(opened.id, { action: "block" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "reason-required" });

    response = await act(opened.id, {
      action: "block",
      reason: "credential harvesting form",
      legalBasis: "Content Policy: phishing",
    });
    expect(response.status).toBe(200);
    const blocked = (await response.json()) as ActResponse;
    expect(blocked.case).toMatchObject({
      status: "actioned",
      actionedAt: expect.any(Number),
      legalBasis: "Content Policy: phishing",
    });
    await expect(publicInfo(slug)).resolves.toEqual({
      pinProtected: false,
      removed: true,
      removedAt: expect.any(Number),
      category: "phishing-malware",
    });

    response = await act(opened.id, { action: "unblock", reason: "blocked in error" });
    expect(response.status).toBe(200);
    await response.body?.cancel();
    await expect(publicInfo(slug)).resolves.toEqual({ pinProtected: false });

    response = await act(opened.id, {
      action: "purge",
      reason: "confirmed phishing",
      block: true,
      withoutEvidence: true,
    });
    expect(response.status).toBe(200);
    await response.body?.cancel();

    response = await SELF.fetch(adminUrl(`/pads/${slug}`), { headers: ADMIN_HEADERS });
    expect(response.status).toBe(200);
    const inspected = (await response.json()) as ActResponse;
    expect(inspected.result).toMatchObject({
      docBytes: 0,
      snapshots: 0,
      blocked: { reason: `case ${opened.id}: confirmed phishing` },
    });
    expect(inspected.actions.every((entry) => entry.caseId === null)).toBe(true);

    const timeline = await adminGet<CaseTimeline>(`/cases/${opened.id}`);
    expect(timeline.actions.map((entry) => `${entry.action}:${entry.outcome}`)).toEqual([
      "case-opened:ok",
      "block:pending",
      "block:ok",
      "unblock:pending",
      "unblock:ok",
      "purge:pending",
      "purge:ok",
    ]);
  });

  it("closes a case, refuses further actions, and opens a new case for a new notice", async () => {
    const slug = uniqueSlug("ledger-close");
    const { case: opened } = await openedCase({ slug, category: "other" });

    let response = await act(opened.id, { action: "explode", reason: "x" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid-action" });

    response = await act(opened.id, { action: "dismiss" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "reason-required" });

    response = await act(opened.id, { action: "dismiss", reason: "not a violation" });
    expect(response.status).toBe(200);
    const dismissed = (await response.json()) as ActResponse;
    expect(dismissed.case).toMatchObject({
      status: "dismissed",
      decision: "not a violation",
      closedAt: expect.any(Number),
    });

    response = await act(opened.id, { action: "block", reason: "too late" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "case-closed" });

    const reopened = await openedCase({ slug, category: "other" });
    expect(reopened.created).toBe(true);
    expect(reopened.case.id).not.toBe(opened.id);
  });

  it("reconciles intents whose outcome was never recorded", async () => {
    const slug = uniqueSlug("ledger-reconcile");
    const { case: opened } = await openedCase({ slug, category: "spam" });
    const room = env.PadRoom.getByName(slug);
    const ledger = env.ModerationLedger.getByName("ledger");

    // Simulates an eviction between the room call and the outcome write: the
    // room applied a block, but only intents reached the log. Both go through
    // the real room op and the ledger's real append path.
    const applied = await room.fetch(roomUrl(slug, "?op=admin-block"), {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: "{}",
    });
    expect(applied.status).toBe(200);
    await applied.body?.cancel();

    type Appender = {
      append(entry: {
        caseId: number;
        slug: string;
        action: string;
        outcome: "pending";
      }): Promise<ActionRecord>;
    };
    const [blockIntent, unblockIntent] = await runInDurableObject<
      ModerationLedger,
      ActionRecord[]
    >(ledger, async (instance) => {
      const appender = instance as unknown as Appender;
      return [
        await appender.append({ caseId: opened.id, slug, action: "block", outcome: "pending" }),
        await appender.append({ caseId: opened.id, slug, action: "unblock", outcome: "pending" }),
      ];
    });

    const reconcile = async () => {
      const response = await SELF.fetch(adminUrl("/reconcile"), {
        method: "POST",
        headers: ADMIN_HEADERS,
      });
      expect(response.status).toBe(200);
      const { reconciled } = (await response.json()) as { reconciled: ActionRecord[] };
      return reconciled.filter((entry) => entry.slug === slug);
    };

    const resolved = await reconcile();
    expect(
      resolved.map((entry) => [JSON.parse(entry.paramsJson).intent, entry.outcome]),
    ).toEqual([
      [blockIntent.seq, "ok"],
      [unblockIntent.seq, "failed"],
    ]);
    await expect(reconcile()).resolves.toEqual([]);

    const timeline = await adminGet<CaseTimeline>(`/cases/${opened.id}`);
    expect(timeline.case.status).toBe("actioned");

    const cleanup = await room.fetch(roomUrl(slug, "?op=admin-unblock"), {
      method: "POST",
      headers: ADMIN_HEADERS,
    });
    await cleanup.body?.cancel();
  });
});

async function openRoomSocket(slug: string): Promise<WebSocket> {
  const response = await SELF.fetch(
    new Request(roomUrl(slug), { headers: { Upgrade: "websocket" } }),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  return socket;
}

/** Resolves with the close code, or null if the socket stays open. */
function closeWithin(socket: WebSocket, timeoutMs = 250): Promise<number | null> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve(-1);
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

async function editorCanWrite(slug: string): Promise<boolean> {
  return runInDurableObject<PadRoom, boolean>(
    env.PadRoom.getByName(slug),
    (instance) =>
      !instance.isReadOnly({
        state: { readonly: false, ip: "" },
      } as unknown as Parameters<PadRoom["isReadOnly"]>[0]),
  );
}

describe("Freeze, disconnect, and the statement of reasons", () => {
  it("freezes a pad: readable, refusing edits, PIN changes, and restores", async () => {
    const slug = uniqueSlug("freeze");
    await writePad(slug, "under review");
    const { case: opened } = await openedCase({ slug, category: "defamation" });
    const socket = await openRoomSocket(slug);
    expect(await editorCanWrite(slug)).toBe(true);

    try {
      // Listen first: the room closes the socket before the action responds.
      const closed = closeWithin(socket, 5000);
      const response = await act(opened.id, { action: "freeze", reason: "pending review" });
      expect(response.status).toBe(200);
      const frozen = (await response.json()) as ActResponse;
      expect(frozen.case?.status).toBe("actioned");
      expect(await closed).toBe(4409);
    } finally {
      if (socket.readyState < WebSocket.CLOSING) socket.close(1000);
    }

    await expect(publicInfo(slug)).resolves.toEqual({
      pinProtected: false,
      frozen: true,
      frozenAt: expect.any(Number),
      category: "defamation",
    });
    expect(await editorCanWrite(slug)).toBe(false);

    let response = await SELF.fetch(roomUrl(slug, "?op=set-pin"), {
      method: "POST",
      body: JSON.stringify({ pin: "1234" }),
    });
    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toEqual({ error: "pad-frozen" });

    response = await SELF.fetch(roomUrl(slug, "?op=restore"), {
      method: "POST",
      body: JSON.stringify({ id: 1 }),
    });
    expect(response.status).toBe(423);
    await response.body?.cancel();

    // Still readable: a frozen pad admits sockets and serves its history.
    const reader = await openRoomSocket(slug);
    expect(await closeWithin(reader)).toBeNull();
    reader.close(1000);
    response = await SELF.fetch(roomUrl(slug, "?op=snapshots"));
    expect(response.status).toBe(200);
    await response.body?.cancel();

    response = await act(opened.id, { action: "unfreeze", reason: "no violation found" });
    expect(response.status).toBe(200);
    await response.body?.cancel();
    await expect(publicInfo(slug)).resolves.toEqual({ pinProtected: false });
    expect(await editorCanWrite(slug)).toBe(true);
  });

  it("keeps a freeze across eviction", async () => {
    const slug = uniqueSlug("freeze-evict");
    const { case: opened } = await openedCase({ slug, category: "spam" });
    const response = await act(opened.id, { action: "freeze", reason: "pending review" });
    await response.body?.cancel();

    const { evictDurableObject } = await import("cloudflare:test");
    await evictDurableObject(env.PadRoom.getByName(slug));
    await expect(publicInfo(slug)).resolves.toMatchObject({ frozen: true });
    expect(await editorCanWrite(slug)).toBe(false);
  });

  it("lets a block outrank a freeze", async () => {
    const slug = uniqueSlug("freeze-block");
    const { case: opened } = await openedCase({ slug, category: "terrorism" });
    for (const action of ["freeze", "block"]) {
      const response = await act(opened.id, { action, reason: "escalated" });
      expect(response.status).toBe(200);
      await response.body?.cancel();
    }
    await expect(publicInfo(slug)).resolves.toEqual({
      pinProtected: false,
      removed: true,
      removedAt: expect.any(Number),
      category: "terrorism",
    });
  });

  it("states the category and date publicly, never the operator's reason", async () => {
    const slug = uniqueSlug("statement");
    const { case: opened } = await openedCase({ slug, category: "copyright" });
    const response = await act(opened.id, {
      action: "block",
      reason: "rights holder notice from counsel, private",
    });
    await response.body?.cancel();

    const raw = await (await SELF.fetch(roomUrl(slug, "?op=info"))).text();
    expect(raw).not.toContain("private");
    expect(JSON.parse(raw)).toMatchObject({ category: "copyright" });

    const inspected = await SELF.fetch(adminUrl(`/pads/${slug}`), { headers: ADMIN_HEADERS });
    const { result } = (await inspected.json()) as ActResponse;
    expect(result?.blocked).toMatchObject({
      reason: `case ${opened.id}: rights holder notice from counsel, private`,
      category: "copyright",
    });
  });

  it("disconnects live sockets without changing access", async () => {
    const slug = uniqueSlug("disconnect");
    const { case: opened } = await openedCase({ slug, category: "spam" });
    const socket = await openRoomSocket(slug);
    try {
      const closed = closeWithin(socket, 5000);
      const response = await act(opened.id, { action: "disconnect", reason: "flood" });
      expect(response.status).toBe(200);
      const disconnected = (await response.json()) as ActResponse;
      expect(disconnected.result).toMatchObject({ ok: true, disconnected: 1 });
      expect(await closed).toBe(4408);
    } finally {
      if (socket.readyState < WebSocket.CLOSING) socket.close(1000);
    }

    await expect(publicInfo(slug)).resolves.toEqual({ pinProtected: false });
    const again = await openRoomSocket(slug);
    expect(await closeWithin(again)).toBeNull();
    again.close(1000);
  });
});

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

type CaptureResponse = ActResponse & { result: { evidence: EvidenceRecord } };
type EvidenceBundle = { evidence: EvidenceRecord; doc: string; text: string };

describe("Evidence", () => {
  it("seals a document over the chunk size byte-identical, with matching hashes", async () => {
    const slug = uniqueSlug("evidence");
    await writePad(slug, "evidence ".repeat(160_000));
    const { case: opened } = await openedCase({ slug, category: "phishing-malware" });

    const response = await act(opened.id, { action: "capture" });
    expect(response.status).toBe(200);
    const captured = (await response.json()) as CaptureResponse;
    const { evidence } = captured.result;
    expect(evidence.docBytes).toBeGreaterThan(1024 * 1024);
    expect(evidence.retainUntil).toBeNull();
    expect(captured.case).toMatchObject({ status: "reviewing" });
    // The log carries hashes and sizes, never the content.
    expect(captured.actions[1].paramsJson).not.toContain("evidence evidence");
    expect(JSON.parse(captured.actions[1].paramsJson).result).toMatchObject({
      evidenceId: evidence.id,
      docSha256: evidence.docSha256,
    });

    const stored = await runInDurableObject<PadRoom, Uint8Array>(
      env.PadRoom.getByName(slug),
      async (_instance, state) =>
        new Uint8Array((await state.storage.get<Uint8Array>("doc"))!),
    );
    expect(await sha256(stored)).toBe(evidence.docSha256);

    const download = await SELF.fetch(adminUrl(`/evidence/${evidence.id}/download`), {
      headers: ADMIN_HEADERS,
    });
    expect(download.status).toBe(200);
    const bundle = (await download.json()) as EvidenceBundle;
    const doc = Uint8Array.from(atob(bundle.doc), (character) => character.charCodeAt(0));
    expect(doc.byteLength).toBe(stored.byteLength);
    expect(await sha256(doc)).toBe(evidence.docSha256);
    expect(await sha256(new TextEncoder().encode(bundle.text))).toBe(evidence.textSha256);
    expect(bundle.text).toContain("evidence evidence");

    const timeline = await adminGet<CaseTimeline & { evidence: EvidenceRecord[] }>(
      `/cases/${opened.id}`,
    );
    expect(timeline.evidence.map((entry) => entry.id)).toEqual([evidence.id]);
    expect(timeline.actions.map((entry) => entry.action)).toContain("evidence-download");
  });

  it("refuses to capture for a removal request", async () => {
    const { case: opened } = await openedCase({
      slug: uniqueSlug("evidence-removal"),
      kind: "removal-request",
      category: "privacy",
    });
    const response = await act(opened.id, { action: "capture" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "capture-not-allowed" });
  });

  it("keeps evidence while its case is open and expires it after closing, unless held", async () => {
    const ledger = env.ModerationLedger.getByName("ledger");
    const capture = async (contact?: string) => {
      const slug = uniqueSlug("evidence-retention");
      await writePad(slug, "retained content");
      const { case: opened } = await openedCase({
        slug,
        category: "spam",
        ...(contact ? { contact } : {}),
      });
      const response = await act(opened.id, { action: "capture" });
      const { result } = (await response.json()) as CaptureResponse;
      return { caseId: opened.id, evidenceId: result.evidence.id };
    };
    const expiring = await capture("reporter@example.com");
    const held = await capture();

    let response = await SELF.fetch(adminUrl(`/evidence/${held.evidenceId}/hold`), {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    await response.body?.cancel();
    response = await SELF.fetch(adminUrl(`/evidence/${held.evidenceId}/hold`), {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ reason: "preservation requested by an authority" }),
    });
    expect(response.status).toBe(200);
    await response.body?.cancel();

    for (const { caseId } of [expiring, held]) {
      const closed = await act(caseId, { action: "close", reason: "handled" });
      expect(closed.status).toBe(200);
      await closed.body?.cancel();
    }
    const { evidence: closedEvidence } = await adminGet<{ evidence: EvidenceRecord }>(
      `/evidence/${expiring.evidenceId}`,
    );
    const retentionMs = MODERATION_PROFILE.evidenceRetentionDays * 24 * 60 * 60 * 1000;
    expect(closedEvidence.retainUntil! - Date.now()).toBeGreaterThan(retentionMs - 60_000);

    // Moving stored clocks past retention, as no interface can age a case.
    await runInDurableObject<ModerationLedger, void>(ledger, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE evidence SET retain_until = 1 WHERE id IN (?, ?)",
        expiring.evidenceId,
        held.evidenceId,
      );
      state.storage.sql.exec("UPDATE cases SET closed_at = 1 WHERE id = ?", expiring.caseId);
    });
    expect(await runDurableObjectAlarm(ledger)).toBe(true);

    response = await SELF.fetch(adminUrl(`/evidence/${expiring.evidenceId}/download`), {
      headers: ADMIN_HEADERS,
    });
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: "evidence-expired" });

    response = await SELF.fetch(adminUrl(`/evidence/${held.evidenceId}/download`), {
      headers: ADMIN_HEADERS,
    });
    expect(response.status).toBe(200);
    await response.body?.cancel();

    const expiredTimeline = await adminGet<CaseTimeline>(`/cases/${expiring.caseId}`);
    expect(expiredTimeline.reports[0].contact).toBeNull();
    const logged = expiredTimeline.actions.map((entry) => entry.action);
    expect(logged).toContain("evidence-expired");
    expect(logged).toContain("contact-expired");

    const heldTimeline = await adminGet<CaseTimeline>(`/cases/${held.caseId}`);
    expect(heldTimeline.actions.map((entry) => entry.action)).not.toContain("evidence-expired");
    await expect(adminGet<ChainVerification>("/actions/verify")).resolves.toMatchObject({
      ok: true,
    });
  });
});

describe("Remove", () => {
  it("removes a violating pad: evidence first, then purge and block in one step", async () => {
    const slug = uniqueSlug("remove");
    await writePad(slug, "a credential harvesting form");
    const { case: opened } = await openedCase({ slug, category: "phishing-malware" });

    const response = await act(opened.id, {
      action: "remove",
      reason: "confirmed phishing",
      legalBasis: "Content Policy: phishing",
    });
    expect(response.status).toBe(200);
    const removed = (await response.json()) as ActResponse & { evidence: EvidenceRecord };

    expect(removed.actions.map((entry) => `${entry.action}:${entry.outcome}`)).toEqual([
      "capture:pending",
      "capture:ok",
      "purge:pending",
      "purge:ok",
    ]);
    expect(removed.evidence.docBytes).toBeGreaterThan(0);
    expect(removed.case).toMatchObject({
      status: "actioned",
      legalBasis: "Content Policy: phishing",
    });
    await expect(publicInfo(slug)).resolves.toMatchObject({
      removed: true,
      category: "phishing-malware",
    });

    const inspected = await SELF.fetch(adminUrl(`/pads/${slug}`), { headers: ADMIN_HEADERS });
    const { result } = (await inspected.json()) as ActResponse;
    expect(result).toMatchObject({ docBytes: 0, snapshots: 0 });

    const download = await SELF.fetch(
      adminUrl(`/evidence/${removed.evidence.id}/download`),
      { headers: ADMIN_HEADERS },
    );
    const bundle = (await download.json()) as EvidenceBundle;
    expect(bundle.text).toContain("a credential harvesting form");
  });

  it("refuses to purge a violation without evidence unless told to", async () => {
    const violation = await openedCase({ slug: uniqueSlug("purge-evidence"), category: "spam" });
    let response = await act(violation.case.id, { action: "purge", reason: "spam" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "evidence-required" });

    response = await act(violation.case.id, {
      action: "purge",
      reason: "spam",
      withoutEvidence: true,
    });
    expect(response.status).toBe(200);
    const purged = (await response.json()) as ActResponse;
    expect(JSON.parse(purged.actions[0].paramsJson)).toMatchObject({ withoutEvidence: true });

    const removal = await openedCase({
      slug: uniqueSlug("purge-removal"),
      kind: "removal-request",
      category: "privacy",
    });
    response = await act(removal.case.id, { action: "remove", reason: "their own pad" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "remove-not-allowed" });
    response = await act(removal.case.id, { action: "purge", reason: "their own pad" });
    expect(response.status).toBe(200);
    await response.body?.cancel();
  });
});

type Timing = {
  count: number;
  medianMs: number | null;
  p90Ms: number | null;
  withinTarget: number | null;
};
type Stats = {
  reports: { total: number; byCategory: Record<string, number>; bySource: Record<string, number> };
  cases: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    byKind: Record<string, number>;
  };
  actions: { ok: Record<string, number>; failed: Record<string, number> };
  evidence: { captured: number; expired: number; onHold: number };
  timing: Record<"grave" | "standard", { targetHours: number; firstReview: Timing; action: Timing }>;
};

describe("Totals and export", () => {
  it("counts notices, cases, actions, and review times within a window", async () => {
    const grave = await openedCase({ slug: uniqueSlug("stats-grave"), category: "terrorism" });
    await openedCase({ slug: grave.case.slug, category: "spam", source: "cloudflare" });
    const standard = await openedCase({ slug: uniqueSlug("stats-standard"), category: "copyright" });

    for (const [caseId, body] of [
      [grave.case.id, { action: "review" }],
      [grave.case.id, { action: "block", reason: "stats" }],
      [standard.case.id, { action: "dismiss", reason: "stats" }],
    ] as const) {
      const response = await act(caseId, body);
      expect(response.status).toBe(200);
      await response.body?.cancel();
    }

    const stats = await adminGet<Stats>(`/stats?from=${grave.case.openedAt}`);
    expect(stats.reports).toEqual({
      total: 3,
      byCategory: { terrorism: 1, spam: 1, copyright: 1 },
      bySource: { email: 2, cloudflare: 1 },
    });
    expect(stats.cases).toEqual({
      total: 2,
      byStatus: { actioned: 1, dismissed: 1 },
      byPriority: { grave: 1, standard: 1 },
      byKind: { violation: 2 },
    });
    expect(stats.actions.ok).toEqual({
      "case-opened": 2,
      "notice-attached": 1,
      review: 1,
      block: 1,
      dismiss: 1,
    });
    expect(stats.timing.grave).toMatchObject({
      targetHours: MODERATION_PROFILE.reviewTargetHours.grave,
      firstReview: { count: 1, withinTarget: 1 },
      action: { count: 1, withinTarget: 1 },
    });
    expect(stats.timing.standard.firstReview).toEqual({
      count: 0,
      medianMs: null,
      p90Ms: null,
      withinTarget: null,
    });

    const response = await SELF.fetch(adminUrl("/stats?from=later"), { headers: ADMIN_HEADERS });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid-range" });
  });

  it("exports JSON and spreadsheet-safe CSV, withholding contact unless asked, and logs it", async () => {
    const slug = uniqueSlug("export");
    const description = '=HYPERLINK("http://example.test"), "quoted"\nsecond line';
    const opened = await openedCase({
      slug,
      category: "other",
      description,
      contact: "reporter@example.com",
    });
    const from = opened.case.openedAt;
    const exportOf = (query: string) =>
      SELF.fetch(adminUrl(`/export/${query}`), { headers: ADMIN_HEADERS });

    let response = await exportOf(`reports?from=${from}`);
    let { rows } = (await response.json()) as { rows: Array<Record<string, unknown>> };
    const withheld = rows.filter((row) => row.slug === slug);
    expect(withheld).toHaveLength(1);
    expect(withheld[0]).not.toHaveProperty("contact");
    expect(withheld[0].description).toBe(description);

    response = await exportOf(`reports?from=${from}&includeContact=1`);
    ({ rows } = (await response.json()) as { rows: Array<Record<string, unknown>> });
    expect(rows.find((row) => row.slug === slug)?.contact).toBe("reporter@example.com");

    response = await exportOf(`reports?format=csv&from=${from}`);
    expect(response.headers.get("content-type")).toContain("text/csv");
    const csv = await response.text();
    expect(csv.split("\r\n")[0]).toBe(
      "id,reference,receivedAt,slug,category,description,source,caseId",
    );
    expect(csv).toContain(
      `"'=HYPERLINK(""http://example.test""), ""quoted""\nsecond line"`,
    );
    expect(csv).not.toContain("reporter@example.com");

    response = await exportOf(`actions?from=${from}`);
    const actions = ((await response.json()) as { rows: ActionRecord[] }).rows;
    expect(actions.filter((row) => row.action === "export")).toHaveLength(3);
    const verify = async (chain: ActionRecord[]) => {
      let prevHash = chain[0].prevHash;
      for (const row of chain) {
        const { hash, ...unsigned } = row;
        if (row.prevHash !== prevHash || (await actionHash(unsigned)) !== hash) return false;
        prevHash = hash;
      }
      return true;
    };
    expect(await verify(actions)).toBe(true);
    expect(
      await verify(actions.map((row, index) => (index === 0 ? { ...row, reason: "edited" } : row))),
    ).toBe(false);

    response = await exportOf("reports?format=xml");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid-format" });
    response = await exportOf("secrets");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "unknown-op" });
  });
});

/** What Turnstile's test sitekeys produce; vitest.config.ts answers siteverify. */
const DUMMY_TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

function submitReport(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch("https://padline.test/api/reports", {
    method: "POST",
    body: JSON.stringify({
      turnstileToken: DUMMY_TURNSTILE_TOKEN,
      category: "spam",
      ...body,
    }),
  });
}

describe("Public reports", () => {
  it("refuses a report that fails Turnstile and stores nothing", async () => {
    const slug = uniqueSlug("report-turnstile");

    for (const turnstileToken of [undefined, "", "a-token-cloudflare-rejects"]) {
      const response = await submitReport({ pad: slug, turnstileToken });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "verification-failed" });
    }

    const { cases } = await adminGet<{ cases: CaseRecord[] }>(`/cases?slug=${slug}`);
    expect(cases).toEqual([]);
  });

  it("answers every valid report the same way, whatever the pad's state", async () => {
    const unused = uniqueSlug("report-unused");
    const blocked = uniqueSlug("report-blocked");
    const withCase = uniqueSlug("report-open-case");

    const block = await env.PadRoom.getByName(blocked).fetch(
      roomUrl(blocked, "?op=admin-block"),
      { method: "POST", headers: ADMIN_HEADERS, body: "{}" },
    );
    expect(block.status).toBe(200);
    await block.body?.cancel();
    await openedCase({ slug: withCase, category: "spam" });

    for (const pad of [unused, blocked, withCase]) {
      const response = await submitReport({ pad });
      expect(response.status).toBe(202);
      const body = (await response.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["ok", "reference"]);
      expect(body.reference).toMatch(/^[0-9a-f]{12}$/);
    }

    // Reporting a pad mints nothing in its room.
    await expect(publicInfo(unused)).resolves.toEqual({ pinProtected: false });
    const inspected = await env.PadRoom.getByName(unused).fetch(
      roomUrl(unused, "?op=admin-info"),
      { headers: ADMIN_HEADERS },
    );
    await expect(inspected.json()).resolves.toMatchObject({ docBytes: 0, snapshots: 0 });

    const cleanup = await env.PadRoom.getByName(blocked).fetch(
      roomUrl(blocked, "?op=admin-unblock"),
      { method: "POST", headers: ADMIN_HEADERS },
    );
    await cleanup.body?.cancel();
  });

  it("files reports from slugs or pad URLs onto one case, keeping contact for the operator", async () => {
    const slug = uniqueSlug("report-attach");

    let response = await submitReport({
      pad: `https://padline.page/${slug}?ro=some-token`,
      category: "harassment-doxxing",
      description: "  publishes my home address  ",
      contact: "reporter@example.com",
    });
    expect(response.status).toBe(202);
    const { reference } = (await response.json()) as { reference: string };

    response = await submitReport({ pad: `/${slug}`, category: "child-sexual-exploitation" });
    expect(response.status).toBe(202);
    await response.body?.cancel();

    const { cases } = await adminGet<{ cases: CaseRecord[] }>(`/cases?slug=${slug}`);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      kind: "violation",
      category: "harassment-doxxing",
      priority: "grave",
      reports: 2,
    });

    const timeline = await adminGet<CaseTimeline>(`/cases/${cases[0].id}`);
    expect(timeline.reports[0]).toMatchObject({
      reference,
      source: "form",
      description: "publishes my home address",
      contact: "reporter@example.com",
    });
    expect(timeline.reports[1]).toMatchObject({ source: "form", contact: null });
  });

  it("accepts appeals and removal requests but not authority requests", async () => {
    const slug = uniqueSlug("report-kinds");

    for (const kind of ["appeal", "removal-request"]) {
      const response = await submitReport({ pad: slug, kind, category: "privacy" });
      expect(response.status).toBe(202);
      await response.body?.cancel();
    }
    const { cases } = await adminGet<{ cases: CaseRecord[] }>(`/cases?slug=${slug}`);
    expect(cases.map((entry) => entry.kind).sort()).toEqual(["appeal", "removal-request"]);

    const response = await submitReport({ pad: slug, kind: "authority-request" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid-kind" });
  });

  it("refuses malformed reports once verified", async () => {
    const refusals: Array<[Record<string, unknown>, string]> = [
      [{ pad: "api" }, "invalid-slug"],
      [{ pad: "https://padline.page/" }, "invalid-slug"],
      [{}, "invalid-slug"],
      [{ pad: uniqueSlug("report-bad"), category: "not-a-category" }, "invalid-category"],
      [{ pad: uniqueSlug("report-bad"), contact: "x".repeat(255) }, "invalid-contact"],
    ];
    for (const [body, error] of refusals) {
      const response = await submitReport(body);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error });
    }

    const response = await SELF.fetch("https://padline.test/api/reports", {
      method: "POST",
      body: "{not-json",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad-json" });
  });
});
