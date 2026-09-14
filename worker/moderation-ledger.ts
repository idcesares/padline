import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import {
  isReportCategory,
  priorityOf,
  type CasePriority,
  type ReportCategory,
} from "../src/lib/moderation-profile";
import { isValidSlug } from "../src/lib/slug";
import { isAdminRequest } from "./admin-auth";

type LedgerEnv = { ADMIN_SECRET?: string };

/** The ledger is a single instance; every caller addresses it by this name. */
export const LEDGER_NAME = "ledger";

export const CASE_KINDS = [
  "violation",
  "removal-request",
  "appeal",
  "authority-request",
] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

export const REPORT_SOURCES = [
  "form",
  "email",
  "cloudflare",
  "authority",
  "other",
] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

export type CaseStatus = "open" | "reviewing" | "actioned" | "dismissed" | "closed";

export type CaseRecord = {
  id: number;
  slug: string;
  kind: CaseKind;
  category: ReportCategory;
  priority: CasePriority;
  status: CaseStatus;
  openedAt: number;
  firstReviewedAt: number | null;
  actionedAt: number | null;
  closedAt: number | null;
  decision: string | null;
  legalBasis: string | null;
  reports: number;
};

export type ReportRecord = {
  id: number;
  receivedAt: number;
  slug: string;
  category: ReportCategory;
  description: string | null;
  contact: string | null;
  source: ReportSource;
  caseId: number;
};

export type ActionOutcome = "pending" | "ok" | "failed";

export type ActionRecord = {
  seq: number;
  at: number;
  caseId: number | null;
  slug: string;
  action: string;
  reason: string | null;
  paramsJson: string;
  outcome: ActionOutcome;
  prevHash: string;
  hash: string;
};

export type ChainVerification =
  | { ok: true; count: number }
  | { ok: false; count: number; brokenAt: number };

type NewAction = {
  caseId: number | null;
  slug: string;
  action: string;
  reason?: string | null;
  params?: Record<string, unknown>;
  outcome?: ActionOutcome;
};

type Row = Record<string, SqlStorageValue>;

const DESCRIPTION_MAX = 2000;
const CONTACT_MAX = 254;
const GENESIS_HASH = "0".repeat(64);
const CLOSED_STATUSES: CaseStatus[] = ["dismissed", "closed"];

/**
 * The action log's hash chain. Each row's hash covers every other column plus
 * the previous row's hash, so editing, deleting, or reordering any row breaks
 * every hash after it. The canonical form is a JSON array in column order;
 * `paramsJson` is hashed as the exact stored string. Exports carry both hashes,
 * so this can be recomputed outside the ledger.
 */
export async function actionHash(
  row: Omit<ActionRecord, "hash">,
): Promise<string> {
  const canonical = JSON.stringify([
    row.seq,
    row.at,
    row.caseId,
    row.slug,
    row.action,
    row.reason,
    row.paramsJson,
    row.outcome,
    row.prevHash,
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * ADR-0018: the moderation ledger. Records every notice, case, and action on
 * reported pads, and — from ticket 02 on — orchestrates room takedowns so none
 * can happen without a record. It never decides whether a pad is blocked: the
 * room stays the authority (ADR-0010).
 *
 * Every request is authorized with the operator's secret before routing, and
 * every refusal answers exactly like an unknown operation.
 */
export class ModerationLedger extends DurableObject<LedgerEnv> {
  private readonly sql: SqlStorage;
  private readonly app: Hono;
  /** Serializes appends: hashing awaits, and the chain must not interleave. */
  private appendTail: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: LedgerEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      kind TEXT NOT NULL,
      category TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      opened_at INTEGER NOT NULL,
      first_reviewed_at INTEGER,
      actioned_at INTEGER,
      closed_at INTEGER,
      decision TEXT,
      legal_basis TEXT
    )`);
    this.sql.exec(
      "CREATE INDEX IF NOT EXISTS cases_by_slug ON cases (slug, kind, status)",
    );
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at INTEGER NOT NULL,
      slug TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      contact TEXT,
      source TEXT NOT NULL,
      case_id INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS actions (
      seq INTEGER PRIMARY KEY,
      at INTEGER NOT NULL,
      case_id INTEGER,
      slug TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      params_json TEXT NOT NULL,
      outcome TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL
    )`);
    this.app = this.routes();
  }

  async fetch(request: Request): Promise<Response> {
    if (!(await isAdminRequest(request, this.env.ADMIN_SECRET))) {
      return unknownOperation();
    }
    return this.app.fetch(request);
  }

  private routes(): Hono {
    const app = new Hono().basePath("/api/admin");

    app.post("/cases", async (c) => {
      const body = await readJson(c.req.raw);
      if (!body) return Response.json({ error: "bad-json" }, { status: 400 });
      const outcome = await this.recordNotice(body);
      if (!outcome.ok) {
        return Response.json({ error: outcome.error }, { status: 400 });
      }
      return Response.json(outcome.value, {
        status: outcome.value.created ? 201 : 200,
      });
    });

    app.get("/cases", (c) => {
      const status = c.req.query("status");
      const priority = c.req.query("priority");
      const slug = c.req.query("slug");
      return Response.json({ cases: this.listCases({ status, priority, slug }) });
    });

    app.get("/cases/:id", (c) => {
      const id = Number(c.req.param("id"));
      const found = Number.isInteger(id) ? this.caseById(id) : null;
      if (!found) return Response.json({ error: "not-found" }, { status: 404 });
      return Response.json({
        case: found,
        reports: this.reportsFor(id),
        actions: this.actionsFor(id),
      });
    });

    app.get("/actions/verify", async () =>
      Response.json(await this.verifyChain()),
    );

    app.notFound(() => unknownOperation());
    return app;
  }

  /**
   * A notice from any source: attach it to the slug's open case of the same
   * kind, or open one. A grave notice raises a standard case to grave; nothing
   * lowers a priority.
   */
  private async recordNotice(body: Record<string, unknown>): Promise<
    | { ok: true; value: { case: CaseRecord; created: boolean; reportId: number } }
    | { ok: false; error: string }
  > {
    const { slug, kind, category, source } = body;
    if (typeof slug !== "string" || !isValidSlug(slug)) {
      return { ok: false, error: "invalid-slug" };
    }
    if (!CASE_KINDS.includes(kind as CaseKind)) {
      return { ok: false, error: "invalid-kind" };
    }
    if (!isReportCategory(category)) {
      return { ok: false, error: "invalid-category" };
    }
    if (!REPORT_SOURCES.includes(source as ReportSource)) {
      return { ok: false, error: "invalid-source" };
    }
    const description = optionalText(body.description, DESCRIPTION_MAX);
    const contact = optionalText(body.contact, CONTACT_MAX);
    if (description === undefined) return { ok: false, error: "invalid-description" };
    if (contact === undefined) return { ok: false, error: "invalid-contact" };

    const now = Date.now();
    // No await inside: find-or-open and the report insert are one atomic step,
    // so two notices on the same slug can never open two cases.
    const { caseId, created, reportId } = this.ctx.storage.transactionSync(() => {
      const existing = this.sql
        .exec(
          `SELECT id, priority FROM cases
           WHERE slug = ? AND kind = ? AND status NOT IN (?, ?)
           ORDER BY id DESC LIMIT 1`,
          slug,
          kind as CaseKind,
          ...CLOSED_STATUSES,
        )
        .toArray()[0];

      let id: number;
      if (existing) {
        id = existing.id as number;
        if (priorityOf(category) === "grave" && existing.priority !== "grave") {
          this.sql.exec("UPDATE cases SET priority = 'grave' WHERE id = ?", id);
        }
      } else {
        id = this.sql
          .exec(
            `INSERT INTO cases (slug, kind, category, priority, status, opened_at)
             VALUES (?, ?, ?, ?, 'open', ?) RETURNING id`,
            slug,
            kind as CaseKind,
            category,
            priorityOf(category),
            now,
          )
          .one().id as number;
      }

      const report = this.sql
        .exec(
          `INSERT INTO reports
             (received_at, slug, category, description, contact, source, case_id)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          now,
          slug,
          category,
          description,
          contact,
          source as ReportSource,
          id,
        )
        .one().id as number;
      return { caseId: id, created: !existing, reportId: report };
    });

    await this.append({
      caseId,
      slug,
      action: created ? "case-opened" : "notice-attached",
      params: { kind, category, source, reportId },
    });

    return {
      ok: true,
      value: { case: this.caseById(caseId)!, created, reportId },
    };
  }

  private listCases(filters: {
    status?: string;
    priority?: string;
    slug?: string;
  }): CaseRecord[] {
    const clauses: string[] = [];
    const bindings: string[] = [];
    if (filters.status) {
      clauses.push("status = ?");
      bindings.push(filters.status);
    }
    if (filters.priority) {
      clauses.push("priority = ?");
      bindings.push(filters.priority);
    }
    if (filters.slug) {
      clauses.push("slug = ?");
      bindings.push(filters.slug);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.sql
      .exec(
        `${CASE_SELECT} ${where}
         ORDER BY CASE priority WHEN 'grave' THEN 0 ELSE 1 END, opened_at, id`,
        ...bindings,
      )
      .toArray()
      .map(toCase);
  }

  private caseById(id: number): CaseRecord | null {
    const row = this.sql.exec(`${CASE_SELECT} WHERE id = ?`, id).toArray()[0];
    return row ? toCase(row) : null;
  }

  private reportsFor(caseId: number): ReportRecord[] {
    return this.sql
      .exec("SELECT * FROM reports WHERE case_id = ? ORDER BY id", caseId)
      .toArray()
      .map((row) => ({
        id: row.id as number,
        receivedAt: row.received_at as number,
        slug: row.slug as string,
        category: row.category as ReportCategory,
        description: row.description as string | null,
        contact: row.contact as string | null,
        source: row.source as ReportSource,
        caseId: row.case_id as number,
      }));
  }

  private actionsFor(caseId: number): ActionRecord[] {
    return this.sql
      .exec("SELECT * FROM actions WHERE case_id = ? ORDER BY seq", caseId)
      .toArray()
      .map(toAction);
  }

  private append(entry: NewAction): Promise<ActionRecord> {
    const written = this.appendTail.then(() => this.writeAction(entry));
    this.appendTail = written.catch(() => undefined);
    return written;
  }

  private async writeAction(entry: NewAction): Promise<ActionRecord> {
    const last = this.sql
      .exec("SELECT seq, hash FROM actions ORDER BY seq DESC LIMIT 1")
      .toArray()[0];
    const unsigned: Omit<ActionRecord, "hash"> = {
      seq: ((last?.seq as number | undefined) ?? 0) + 1,
      at: Date.now(),
      caseId: entry.caseId,
      slug: entry.slug,
      action: entry.action,
      reason: entry.reason ?? null,
      paramsJson: JSON.stringify(entry.params ?? {}),
      outcome: entry.outcome ?? "ok",
      prevHash: (last?.hash as string | undefined) ?? GENESIS_HASH,
    };
    const record: ActionRecord = { ...unsigned, hash: await actionHash(unsigned) };
    this.sql.exec(
      `INSERT INTO actions
         (seq, at, case_id, slug, action, reason, params_json, outcome, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.seq,
      record.at,
      record.caseId,
      record.slug,
      record.action,
      record.reason,
      record.paramsJson,
      record.outcome,
      record.prevHash,
      record.hash,
    );
    return record;
  }

  private async verifyChain(): Promise<ChainVerification> {
    const rows = this.sql
      .exec("SELECT * FROM actions ORDER BY seq")
      .toArray()
      .map(toAction);
    let prevHash = GENESIS_HASH;
    for (const [index, row] of rows.entries()) {
      const { hash, ...unsigned } = row;
      if (
        row.seq !== index + 1 ||
        row.prevHash !== prevHash ||
        (await actionHash(unsigned)) !== hash
      ) {
        return { ok: false, count: rows.length, brokenAt: row.seq };
      }
      prevHash = hash;
    }
    return { ok: true, count: rows.length };
  }
}

const CASE_SELECT = `SELECT cases.*,
  (SELECT COUNT(*) FROM reports WHERE reports.case_id = cases.id) AS report_count
  FROM cases`;

function toCase(row: Row): CaseRecord {
  return {
    id: row.id as number,
    slug: row.slug as string,
    kind: row.kind as CaseKind,
    category: row.category as ReportCategory,
    priority: row.priority as CasePriority,
    status: row.status as CaseStatus,
    openedAt: row.opened_at as number,
    firstReviewedAt: row.first_reviewed_at as number | null,
    actionedAt: row.actioned_at as number | null,
    closedAt: row.closed_at as number | null,
    decision: row.decision as string | null,
    legalBasis: row.legal_basis as string | null,
    reports: row.report_count as number,
  };
}

function toAction(row: Row): ActionRecord {
  return {
    seq: row.seq as number,
    at: row.at as number,
    caseId: row.case_id as number | null,
    slug: row.slug as string,
    action: row.action as string,
    reason: row.reason as string | null,
    paramsJson: row.params_json as string,
    outcome: row.outcome as ActionOutcome,
    prevHash: row.prev_hash as string,
    hash: row.hash as string,
  };
}

/** `null` when absent or blank, `undefined` when present but unusable. */
function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? undefined : trimmed;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function unknownOperation(): Response {
  return Response.json({ error: "unknown-op" }, { status: 404 });
}
