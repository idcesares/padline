// ADR-0002: the public report endpoint and the operator's admin API. Pad
// content never passes through here except as a live excerpt for the operator,
// which is read from the room per request and not stored anywhere.

import { getServerByName } from "partyserver";
import {
  ADMIN_FILTERS,
  type AdminFilter,
  CONTACT_MAX,
  NOTE_MAX,
  isCategory,
} from "../shared/moderation";
import { isValidSlug, normalizeSlug } from "../shared/slug";
import { authorizeAdmin } from "./access";
import type { Env, PadRoom } from "./pad-room";

const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 50;
const LOG_LIMIT = 30;
/** Reports kept open per slug. Past it a report is accepted and dropped. */
const OPEN_REPORTS_PER_SLUG = 50;
const MAX_BODY_BYTES = 4 * 1024;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return null;
  // Refuse a declared oversize body before reading any of it; the check below covers chunked bodies.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Consumes a body the handler did not read, so an unread one cannot break the
 * next request on a kept-alive connection. Bounded: past the limit the rest is
 * cancelled, not buffered, because the caller may be unauthenticated.
 */
async function discardBody(request: Request): Promise<void> {
  if (request.bodyUsed || !request.body) return;
  const reader = request.body.getReader();
  try {
    let seen = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      seen += value.byteLength;
      if (seen > MAX_BODY_BYTES) {
        await reader.cancel();
        return;
      }
    }
  } catch {
    // The client went away; nothing left to drain.
  }
}

const cleanText = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim().slice(0, max);
  return text === "" ? null : text;
};

/**
 * `POST /api/report`. The answer is the same whether or not the pad exists:
 * the slug is never looked up, and no request header, address or fingerprint is
 * read or stored (ADR-0002). A bad shape is the only thing that answers
 * differently, and it does so before any slug is considered.
 */
export async function handleReport(request: Request, env: Env): Promise<Response> {
  const response = await reportResponse(request, env);
  await discardBody(request);
  return response;
}

async function reportResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method-not-allowed" }, 405);
  const body = await readJson(request);
  const slug = typeof body?.slug === "string" ? normalizeSlug(body.slug) : "";
  if (!body || slug === "" || !isCategory(body.category)) {
    return json({ error: "invalid-report" }, 400);
  }
  // A reserved or malformed address can never be a pad, and the operator could
  // never act on it, so it would only sit in the queue. Same answer, no row.
  if (!isValidSlug(slug)) return json({ ok: true });
  const note = cleanText(body.note, NOTE_MAX);
  const contact = cleanText(body.contact, CONTACT_MAX);
  try {
    await env.DB.prepare(
      `INSERT INTO reports (slug, category, note, contact, created)
       SELECT ?1, ?2, ?3, ?4, ?5
       WHERE (SELECT COUNT(*) FROM reports WHERE slug = ?1 AND resolved_at IS NULL) < ?6`,
    )
      .bind(slug, body.category, note, contact, Date.now(), OPEN_REPORTS_PER_SLUG)
      .run();
  } catch (error) {
    console.error("report write failed", error);
    return json({ error: "unavailable" }, 503);
  }
  return json({ ok: true });
}

type PadRow = {
  slug: string;
  size: number | null;
  created: number | null;
  last_edit: number | null;
  edits: number | null;
  status: string;
  reports: number;
};

const query = (sql: string, params: (string | number | null)[]) => ({ sql, params });

function listQuery(filter: AdminFilter, q: string, now: number) {
  const like = q ? `%${q}%` : null;
  if (filter === "reported") {
    return query(
      `SELECT r.slug AS slug, p.size AS size, p.created AS created,
              p.last_edit AS last_edit, p.edits AS edits,
              COALESCE(p.status, 'live') AS status, COUNT(*) AS reports
         FROM reports r LEFT JOIN pads p ON p.slug = r.slug
        WHERE r.resolved_at IS NULL AND (?1 IS NULL OR r.slug LIKE ?1)
        GROUP BY r.slug
        ORDER BY COUNT(*) DESC, MAX(r.created) DESC
        LIMIT ${LIST_LIMIT}`,
      [like],
    );
  }
  const order =
    filter === "largest"
      ? "p.size DESC"
      : filter === "active"
        ? "p.edits DESC, p.last_edit DESC"
        : "p.last_edit DESC";
  return query(
    `SELECT p.slug, p.size, p.created, p.last_edit, p.edits, p.status,
            (SELECT COUNT(*) FROM reports r
              WHERE r.slug = p.slug AND r.resolved_at IS NULL) AS reports
       FROM pads p
      WHERE (?1 IS NULL OR p.slug LIKE ?1)
        AND (?2 IS NULL OR p.last_edit > ?2)
      ORDER BY ${order}
      LIMIT ${LIST_LIMIT}`,
    [like, filter === "active" ? now - DAY_MS : null],
  );
}

async function roomOf(env: Env, slug: string) {
  return (await getServerByName(env.PadRoom as never, slug)) as unknown as DurableObjectStub<PadRoom>;
}

/**
 * Everything under `/api/admin/`. Every request is authorized first, and a
 * state change must come from this site's own origin. The room is always asked
 * first: the D1 rows below are the record of what the room already did.
 */
export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const response = await adminResponse(request, env);
  await discardBody(request);
  return response;
}

async function adminResponse(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const auth = await authorizeAdmin(request, env);
  if (!auth.ok) return json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, auth.status);

  const isRead = request.method === "GET";
  if (!isRead && request.headers.get("origin") !== url.origin) {
    return json({ error: "forbidden" }, 403);
  }

  const path = url.pathname.slice("/api/admin/".length).split("/");
  const now = Date.now();

  try {
    if (isRead && path[0] === "pads" && path.length === 1) {
      const raw = url.searchParams.get("filter") ?? "recent";
      const filter = (ADMIN_FILTERS as readonly string[]).includes(raw)
        ? (raw as AdminFilter)
        : "recent";
      const q = (url.searchParams.get("q") ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 64);
      const { sql, params } = listQuery(filter, q, now);
      const { results } = await env.DB.prepare(sql).bind(...params).all<PadRow>();
      return json({ pads: results });
    }

    if (isRead && path[0] === "actions" && path.length === 1) {
      const { results } = await env.DB.prepare(
        `SELECT at, action, slug, category FROM actions ORDER BY id DESC LIMIT ${LOG_LIMIT}`,
      ).all();
      return json({ actions: results });
    }

    if (path[0] === "pads" && path.length >= 2) {
      let slug: string;
      try {
        slug = decodeURIComponent(path[1]);
      } catch {
        return json({ error: "invalid-slug" }, 400);
      }
      if (!isValidSlug(slug)) return json({ error: "invalid-slug" }, 400);
      const verb = path[2];

      if (isRead && verb === undefined) {
        const pad = await env.DB.prepare(
          "SELECT slug, size, created, last_edit, edits, status FROM pads WHERE slug = ?",
        )
          .bind(slug)
          .first();
        const { results: reports } = await env.DB.prepare(
          `SELECT id, category, note, contact, created FROM reports
            WHERE slug = ? AND resolved_at IS NULL ORDER BY created DESC LIMIT 20`,
        )
          .bind(slug)
          .all();
        // The excerpt is read from the room each time and never stored. Only
        // for pads the index knows, so a lookup cannot spin up empty rooms.
        const live = pad && pad.status !== "blocked";
        const excerpt = live ? await (await roomOf(env, slug)).adminExcerpt() : null;
        return json({ slug, pad, reports, excerpt });
      }

      if (request.method === "POST" && verb === "clear") {
        // Only pads the index knows: clearing an unknown slug would create and log a pad that never existed.
        const known = await env.DB.prepare("SELECT 1 AS ok FROM pads WHERE slug = ?").bind(slug).first();
        if (!known) return json({ error: "not-found" }, 404);
        const { size, blocked } = await (await roomOf(env, slug)).adminClear();
        if (blocked) return json({ error: "blocked" }, 409);
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE pads SET status = 'emptied', size = ?2 WHERE slug = ?1",
          ).bind(slug, size),
          resolveReports(env, slug, now),
          logAction(env, now, "clear", slug, null),
        ]);
        return json({ ok: true });
      }

      if (request.method === "POST" && verb === "block") {
        const body = await readJson(request);
        if (!body || !isCategory(body.category)) return json({ error: "invalid-category" }, 400);
        const { done, category } = await (await roomOf(env, slug)).adminBlock(body.category);
        if (!done) {
          // Already blocked in the room. If the index agrees, nothing to do; if it does
          // not (an earlier write failed with 503), fall through and finish the record.
          const row = await env.DB.prepare("SELECT status FROM pads WHERE slug = ?").bind(slug).first<{ status: string }>();
          if (row?.status === "blocked") return json({ error: "blocked" }, 409);
        }
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO pads (slug, size, created, last_edit, edits, status)
             VALUES (?1, 0, ?2, ?2, 0, 'blocked')
             ON CONFLICT (slug) DO UPDATE SET status = 'blocked', size = 0`,
          ).bind(slug, now),
          resolveReports(env, slug, now),
          logAction(env, now, "block", slug, category),
        ]);
        return json({ ok: true });
      }

      if (request.method === "POST" && verb === "dismiss") {
        await env.DB.batch([
          resolveReports(env, slug, now),
          logAction(env, now, "dismiss", slug, null),
        ]);
        return json({ ok: true });
      }
    }
  } catch (error) {
    console.error("admin request failed", error);
    return json({ error: "unavailable" }, 503);
  }

  return json({ error: "not-found" }, 404);
}

const resolveReports = (env: Env, slug: string, now: number) =>
  env.DB.prepare(
    "UPDATE reports SET resolved_at = ?2 WHERE slug = ?1 AND resolved_at IS NULL",
  ).bind(slug, now);

const logAction = (
  env: Env,
  now: number,
  action: "clear" | "block" | "dismiss",
  slug: string,
  category: string | null,
) =>
  env.DB.prepare(
    "INSERT INTO actions (at, action, slug, category) VALUES (?, ?, ?, ?)",
  ).bind(now, action, slug, category);
