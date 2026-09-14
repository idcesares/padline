import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  MODERATION_PROFILE,
  isReportCategory,
  priorityOf,
} from "../src/lib/moderation-profile";
import type { ModerationLedger } from "../worker";
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
