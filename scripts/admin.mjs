// Moderation CLI for the moderation ledger (ADR-0018). Every command goes
// through /api/admin/*, so every review and takedown is recorded; the room's
// own admin ops are no longer reachable from outside.
//
// Usage: node scripts/admin.mjs --help
//
// ADMIN_SECRET is read from the environment, then .dev.vars.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const USAGE = `Usage:
  node scripts/admin.mjs <host> cases [--status open] [--priority grave] [--slug <slug>]
  node scripts/admin.mjs <host> case open <slug> --category <id>
        [--kind violation|removal-request|appeal|authority-request]
        [--source email|cloudflare|authority|other] [--note "..."] [--contact "..."]
  node scripts/admin.mjs <host> case <id>
  node scripts/admin.mjs <host> case <id> review|capture
  node scripts/admin.mjs <host> case <id> freeze|unfreeze|disconnect|block|unblock|purge|dismiss|close --reason "..."
        [--legal-basis "..."] [--block]      (--block applies to purge)
  node scripts/admin.mjs <host> evidence <id>
  node scripts/admin.mjs <host> evidence <id> download [--out <dir>]
  node scripts/admin.mjs <host> evidence <id> hold|release --reason "..."
  node scripts/admin.mjs <host> case <id> remove --reason "..." [--legal-basis "..."]
        (a violation: seal evidence, then purge and block)
  node scripts/admin.mjs <host> bulk <file> <action> --category <id> --reason "..."
        [--kind ...] [--source ...] [--legal-basis "..."] [--block] [--without-evidence] [--apply]
        (one slug or pad URL per line, # comments; a dry run unless --apply)
  node scripts/admin.mjs <host> stats [--from YYYY-MM-DD] [--to YYYY-MM-DD]
  node scripts/admin.mjs <host> export reports|cases|actions|evidence [--format json|csv]
        [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--include-contact]      (to stdout)
  node scripts/admin.mjs <host> pad <slug> info
  node scripts/admin.mjs <host> reconcile
  node scripts/admin.mjs <host> verify-chain
  node scripts/admin.mjs verify-chain --file <actions-export.json>     (offline)

<host>: padline.page, https://padline.page, or 127.0.0.1:8788
Categories are the ids in src/lib/moderation-profile.ts.`;

const BOOLEAN_FLAGS = new Set([
  "block",
  "help",
  "apply",
  "without-evidence",
  "include-contact",
]);

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const BULK_ACTIONS = [
  "review",
  "capture",
  "freeze",
  "unfreeze",
  "disconnect",
  "block",
  "unblock",
  "purge",
  "remove",
  "dismiss",
  "close",
];

function die(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(args) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      die(`--${name} needs a value.\n\n${USAGE}`);
    }
    flags[name] = value;
    index++;
  }
  return { positional, flags };
}

function readDevVar(name) {
  try {
    const line = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
      .split(/\r?\n/)
      .find((candidate) => candidate.trimStart().startsWith(`${name}=`));
    if (!line) return undefined;
    return line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
  } catch {
    return undefined;
  }
}

/** Same canonical form as actionHash in worker/moderation-ledger.ts. */
function verifyExportedChain(file) {
  const exported = JSON.parse(readFileSync(file, "utf8"));
  const rows = Array.isArray(exported) ? exported : exported.rows;
  if (!Array.isArray(rows)) die(`${file} is not an actions export.`);
  let prevHash = rows[0]?.prevHash;
  for (const [index, row] of rows.entries()) {
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
    const hash = createHash("sha256").update(canonical).digest("hex");
    const contiguous = index === 0 || row.seq === rows[index - 1].seq + 1;
    if (row.prevHash !== prevHash || hash !== row.hash || !contiguous) {
      die(`Exported action log BROKEN at seq ${row.seq}.`);
    }
    prevHash = row.hash;
  }
  console.log(
    rows.length
      ? `Exported action log intact: ${rows.length} action(s), seq ${rows[0].seq}–${rows.at(-1).seq}, anchored at ${rows[0].prevHash.slice(0, 12)}…`
      : "Exported action log is empty.",
  );
}

/** A slug, `/slug`, or full pad URL — the same reading the report form uses. */
function padSlug(pad) {
  const trimmed = pad.trim();
  if (!/[/.]/.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return trimmed.slice(1).split(/[/?#]/)[0];
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return decodeURIComponent(url.pathname.split("/")[1] ?? "");
  } catch {
    return trimmed;
  }
}

/** A --to date without a time includes that whole day. */
function dateBound(value, isEnd) {
  if (value === undefined) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) die(`Not a date: ${value}`);
  return isEnd && /^\d{4}-\d{2}-\d{2}$/.test(value) ? ms + 86_400_000 : ms;
}

function duration(ms) {
  if (ms === null || ms === undefined) return "—";
  const minutes = ms / 60_000;
  if (minutes < 90) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  return hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} d`;
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [host, command, ...rest] = positional;
if (flags.help) {
  console.log(USAGE);
  process.exit(0);
}
// Offline: checks an exported action log without contacting any host.
if (host === "verify-chain" && typeof flags.file === "string") {
  verifyExportedChain(flags.file);
  process.exit(0);
}
if (!host || !command) die(USAGE);

const secret = process.env.ADMIN_SECRET ?? readDevVar("ADMIN_SECRET");
if (!secret) die("ADMIN_SECRET is not set in the environment or .dev.vars.");

const isLocal = /^(localhost|127\.)/.test(host);
const origin = (
  host.startsWith("http") ? host : `${isLocal ? "http" : "https"}://${host}`
).replace(/\/$/, "");

async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(`${origin}/api/admin${path}`, {
    method,
    headers: { authorization: `Bearer ${secret}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => null);
  if (res.status === 404 && data?.error === "unknown-op") {
    die(
      "Rejected as unknown-op: wrong ADMIN_SECRET, the secret is not deployed on this host, or the host predates the moderation ledger.",
    );
  }
  return { res, data };
}

function expectOk({ res, data }) {
  if (!res.ok) die(`HTTP ${res.status}: ${JSON.stringify(data, null, 2)}`);
  return data;
}

const when = (ms) =>
  ms ? `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")}Z` : "—";

function printCase(entry) {
  console.log(
    `#${entry.id} ${entry.priority.toUpperCase()} ${entry.status} — /${entry.slug}`,
  );
  console.log(
    `  ${entry.kind}, ${entry.category}, ${entry.reports} notice(s)`,
  );
  console.log(
    `  opened ${when(entry.openedAt)} · first review ${when(entry.firstReviewedAt)} · actioned ${when(entry.actionedAt)} · closed ${when(entry.closedAt)}`,
  );
  if (entry.decision) console.log(`  decision: ${entry.decision}`);
  if (entry.legalBasis) console.log(`  legal basis: ${entry.legalBasis}`);
}

function printActions(actions) {
  for (const action of actions) {
    console.log(
      `  [${action.seq}] ${when(action.at)} ${action.action} ${action.outcome}${action.reason ? ` — ${action.reason}` : ""}`,
    );
  }
}

function printEvidence(evidence) {
  console.log(
    `evidence #${evidence.id} — case #${evidence.caseId} /${evidence.slug}, captured ${when(evidence.capturedAt)}`,
  );
  console.log(`  document ${evidence.docBytes} bytes  sha256 ${evidence.docSha256}`);
  console.log(`  text     ${evidence.textBytes} bytes  sha256 ${evidence.textSha256}`);
  const retention = evidence.deletedAt
    ? `deleted ${when(evidence.deletedAt)}`
    : evidence.retainUntil
      ? `kept until ${when(evidence.retainUntil)}`
      : "kept while the case is open";
  console.log(`  ${retention}${evidence.hold ? " · ON HOLD" : ""}`);
}

function printReview(result = {}) {
  const { text, ...meta } = result;
  console.log(JSON.stringify(meta, null, 2));
  console.log(text ? `\n--- content preview ---\n${text}` : "\n(no persisted content)");
}

switch (command) {
  case "cases": {
    const query = new URLSearchParams();
    for (const key of ["status", "priority", "slug"]) {
      if (flags[key]) query.set(key, flags[key]);
    }
    const suffix = query.size ? `?${query}` : "";
    const { cases } = expectOk(await call(`/cases${suffix}`));
    if (cases.length === 0) console.log("No cases.");
    for (const entry of cases) {
      console.log(
        [
          `#${entry.id}`,
          entry.priority,
          entry.status,
          entry.kind,
          entry.category,
          `${entry.reports} notice(s)`,
          when(entry.openedAt),
          `/${entry.slug}`,
        ].join("\t"),
      );
    }
    break;
  }

  case "case": {
    const [target, verb] = rest;
    if (target === "open") {
      const slug = rest[1];
      if (!slug || !flags.category) die(USAGE);
      const data = expectOk(
        await call("/cases", {
          method: "POST",
          body: {
            slug,
            category: flags.category,
            kind: flags.kind ?? "violation",
            source: flags.source ?? "email",
            description: flags.note,
            contact: flags.contact,
          },
        }),
      );
      console.log(data.created ? "Opened a new case." : "Attached to the open case.");
      printCase(data.case);
      break;
    }

    const id = Number(target);
    if (!Number.isInteger(id)) die(USAGE);

    if (!verb) {
      const data = expectOk(await call(`/cases/${id}`));
      printCase(data.case);
      console.log("\nNotices:");
      for (const report of data.reports) {
        console.log(
          `  ${when(report.receivedAt)} ${report.source} ${report.category}${report.reference ? ` ref ${report.reference}` : ""}${report.contact ? ` <${report.contact}>` : ""}${report.description ? ` — ${report.description}` : ""}`,
        );
      }
      if (data.evidence.length) {
        console.log("\nEvidence:");
        for (const evidence of data.evidence) printEvidence(evidence);
      }
      console.log("\nActions:");
      printActions(data.actions);
      break;
    }

    const data = expectOk(
      await call(`/cases/${id}/actions`, {
        method: "POST",
        body: {
          action: verb,
          reason: flags.reason,
          legalBasis: flags["legal-basis"],
          ...(verb === "purge"
            ? { block: flags.block === true, withoutEvidence: flags["without-evidence"] === true }
            : {}),
        },
      }),
    );
    if (verb === "review") printReview(data.result);
    else if (verb === "capture") printEvidence(data.result.evidence);
    else if (verb === "remove") printEvidence(data.evidence);
    else if (data.result) console.log(JSON.stringify(data.result, null, 2));
    console.log();
    printCase(data.case);
    printActions(data.actions);
    break;
  }

  case "evidence": {
    const [target, verb] = rest;
    const id = Number(target);
    if (!Number.isInteger(id)) die(USAGE);

    if (!verb) {
      printEvidence(expectOk(await call(`/evidence/${id}`)).evidence);
      break;
    }

    if (verb === "download") {
      const data = expectOk(await call(`/evidence/${id}/download`));
      const doc = Buffer.from(data.doc, "base64");
      const text = Buffer.from(data.text, "utf8");
      const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
      if (
        sha256(doc) !== data.evidence.docSha256 ||
        sha256(text) !== data.evidence.textSha256
      ) {
        die("Hash mismatch: the download does not match the sealed evidence. Nothing was written.");
      }
      const outDir = flags.out ?? ".";
      mkdirSync(outDir, { recursive: true });
      const base = join(outDir, `${data.evidence.slug}-evidence-${id}`);
      writeFileSync(`${base}.yjs`, doc);
      writeFileSync(`${base}.txt`, text);
      writeFileSync(
        `${base}.manifest.json`,
        `${JSON.stringify({ ...data.evidence, host: origin, downloadedAt: new Date().toISOString() }, null, 2)}\n`,
      );
      printEvidence(data.evidence);
      console.log(`\nWrote ${base}.yjs, .txt, and .manifest.json — both hashes verified.`);
      break;
    }

    if (verb === "hold" || verb === "release") {
      const data = expectOk(
        await call(`/evidence/${id}/${verb}`, {
          method: "POST",
          body: { reason: flags.reason },
        }),
      );
      printEvidence(data.evidence);
      break;
    }

    die(USAGE);
  }

  case "bulk": {
    const [file, action] = rest;
    if (!file || !BULK_ACTIONS.includes(action)) die(USAGE);
    if (!flags.category) die("--category is required: it files each pad's case.");
    if (action !== "review" && action !== "capture" && !flags.reason) {
      die(`--reason is required for bulk ${action}.`);
    }
    const kind = flags.kind ?? "violation";
    const pads = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*/, "").trim())
      .filter(Boolean);

    const results = [];
    for (const pad of pads) {
      const slug = padSlug(pad);
      if (!SLUG_PATTERN.test(slug)) {
        results.push({ slug: pad, caseId: "—", outcome: "failed: invalid slug" });
        continue;
      }
      if (!flags.apply) {
        const { cases } = expectOk(await call(`/cases?slug=${encodeURIComponent(slug)}`));
        const open = cases.find(
          (entry) => entry.kind === kind && !["dismissed", "closed"].includes(entry.status),
        );
        results.push({
          slug,
          caseId: open ? `#${open.id}` : "new case",
          outcome: `would ${action}`,
        });
        continue;
      }
      const opened = await call("/cases", {
        method: "POST",
        body: {
          slug,
          kind,
          category: flags.category,
          source: flags.source ?? "other",
          description: `bulk ${action} from ${basename(file)}`,
        },
      });
      if (!opened.res.ok) {
        results.push({ slug, caseId: "—", outcome: `failed: ${opened.data?.error ?? opened.res.status}` });
        continue;
      }
      const caseId = opened.data.case.id;
      const acted = await call(`/cases/${caseId}/actions`, {
        method: "POST",
        body: {
          action,
          reason: flags.reason,
          legalBasis: flags["legal-basis"],
          ...(action === "purge"
            ? { block: flags.block === true, withoutEvidence: flags["without-evidence"] === true }
            : {}),
        },
      });
      results.push({
        slug,
        caseId: `#${caseId}`,
        outcome: acted.res.ok
          ? "ok"
          : `failed: ${acted.data?.error ?? acted.res.status}${acted.data?.detail ? ` (${acted.data.detail})` : ""}`,
      });
    }

    for (const result of results) {
      console.log([result.caseId, result.outcome, `/${result.slug}`].join("\t"));
    }
    const failed = results.filter((result) => result.outcome.startsWith("failed"));
    if (!flags.apply) {
      console.log(`\nDry run: nothing changed. Re-run with --apply to act on ${pads.length} pad(s).`);
    } else {
      console.log(`\n${results.length - failed.length} ok, ${failed.length} failed.`);
    }
    if (failed.length) process.exit(1);
    break;
  }

  case "stats": {
    const query = new URLSearchParams();
    const from = dateBound(flags.from, false);
    const to = dateBound(flags.to, true);
    if (from !== undefined) query.set("from", String(from));
    if (to !== undefined) query.set("to", String(to));
    const stats = expectOk(await call(`/stats${query.size ? `?${query}` : ""}`));
    const counts = (label, tally) =>
      console.log(
        `  ${label}: ${Object.entries(tally).map(([key, n]) => `${key} ${n}`).join(", ") || "none"}`,
      );

    console.log(`Window: ${flags.from ?? "the beginning"} → ${flags.to ?? "now"}`);
    console.log(`\nNotices: ${stats.reports.total}`);
    counts("by category", stats.reports.byCategory);
    counts("by source", stats.reports.bySource);
    console.log(`\nCases: ${stats.cases.total}`);
    counts("by status", stats.cases.byStatus);
    counts("by priority", stats.cases.byPriority);
    counts("by kind", stats.cases.byKind);
    console.log("\nActions");
    counts("done", stats.actions.ok);
    counts("failed", stats.actions.failed);
    console.log(
      `\nEvidence: ${stats.evidence.captured} captured, ${stats.evidence.expired} expired, ${stats.evidence.onHold} on hold now`,
    );
    for (const priority of ["grave", "standard"]) {
      const { targetHours, firstReview, action } = stats.timing[priority];
      const describe = (label, measured) =>
        console.log(
          `  ${label}: ${measured.count} case(s), median ${duration(measured.medianMs)}, p90 ${duration(measured.p90Ms)}, within target ${measured.withinTarget === null ? "—" : `${Math.round(measured.withinTarget * 100)}%`}`,
        );
      console.log(`\n${priority} (target ${targetHours} h)`);
      describe("first review", firstReview);
      describe("action", action);
    }
    break;
  }

  case "export": {
    const [table] = rest;
    if (!["reports", "cases", "actions", "evidence"].includes(table)) die(USAGE);
    const query = new URLSearchParams({ format: flags.format ?? "json" });
    const from = dateBound(flags.from, false);
    const to = dateBound(flags.to, true);
    if (from !== undefined) query.set("from", String(from));
    if (to !== undefined) query.set("to", String(to));
    if (flags["include-contact"]) query.set("includeContact", "1");
    const res = await fetch(`${origin}/api/admin/export/${table}?${query}`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    if (!res.ok) die(`HTTP ${res.status}: ${await res.text()}`);
    process.stdout.write(await res.text());
    break;
  }

  case "pad": {
    const [slug, verb] = rest;
    if (!slug || verb !== "info") die(USAGE);
    const data = expectOk(await call(`/pads/${slug}`));
    printReview(data.result);
    console.log("\n(recorded as a review with no case)");
    break;
  }

  case "reconcile": {
    const { reconciled } = expectOk(await call("/reconcile", { method: "POST" }));
    console.log(
      reconciled.length
        ? `Resolved ${reconciled.length} pending action(s):`
        : "No pending actions.",
    );
    printActions(reconciled);
    break;
  }

  case "verify-chain": {
    const data = expectOk(await call("/actions/verify"));
    if (!data.ok) die(`Action log BROKEN at seq ${data.brokenAt} (of ${data.count}).`);
    console.log(`Action log intact: ${data.count} action(s).`);
    break;
  }

  default:
    die(USAGE);
}
