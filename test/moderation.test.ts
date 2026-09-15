import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  MODERATION_PROFILE,
  isReportCategory,
  priorityOf,
} from "../src/lib/moderation-profile";
import type { ModerationLedger, PadRoom } from "../worker";
import { isAdminRequest } from "../worker/admin-auth";
import type {
  ActionRecord,
  CaseRecord,
  ChainVerification,
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
    });

    response = await act(opened.id, { action: "unblock", reason: "blocked in error" });
    expect(response.status).toBe(200);
    await response.body?.cancel();
    await expect(publicInfo(slug)).resolves.toEqual({ pinProtected: false });

    response = await act(opened.id, {
      action: "purge",
      reason: "confirmed phishing",
      block: true,
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
