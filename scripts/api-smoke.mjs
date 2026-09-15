// Smoke test for the PadRoom HTTP/WS surface. Requires the dev server.
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const noAdmin = argv.includes("--no-admin");
const arg = argv.find((value) => !value.startsWith("--")) ?? "127.0.0.1:8788";
const secure = arg.startsWith("https://");
const HOST = arg.replace(/^https?:\/\//, "");
const HTTP = secure ? "https" : "http";
const WS = secure ? "wss" : "ws";
const slug = `smoke-${Math.random().toString(36).slice(2, 8)}`;
const base = `${HTTP}://${HOST}/parties/pad-room/${slug}`;

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "OK  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
}

// The takedown lifecycle is part of this suite, not an optional extra: a run
// that quietly skips it prints ALL PASS with the whole admin surface untested.
// Resolve the secret the way e2e/pad-session.spec.ts does — the environment
// first, then .dev.vars, which wrangler already injects into the Worker — and
// treat an unrunnable lifecycle as a failure unless --no-admin says otherwise.
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

const adminSecret = process.env.ADMIN_SECRET ?? readDevVar("ADMIN_SECRET");

function wsResult(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      resolve({ kind: "timeout" });
    }, 8000);
    ws.addEventListener("open", () => {
      // Wait briefly: the server may accept then close with a code.
      setTimeout(() => {
        clearTimeout(timer);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
          resolve({ kind: "open" });
        }
      }, 500);
    });
    ws.addEventListener("close", (e) => {
      clearTimeout(timer);
      resolve({ kind: "close", code: e.code });
    });
    ws.addEventListener("error", () => {});
  });
}

// 1. info on a fresh pad
let res = await fetch(`${base}?op=info`);
let data = await res.json();
check("info: fresh pad unprotected", res.ok && data.pinProtected === false);

// 2. open WS without auth (no PIN yet) — should connect
let ws = await wsResult(`${WS}://${HOST}/parties/pad-room/${slug}`);
check("ws: connects when unprotected", ws.kind === "open", ws.kind);

// 3. set a PIN
res = await fetch(`${base}?op=set-pin`, {
  method: "POST",
  body: JSON.stringify({ pin: "1234" }),
});
data = await res.json();
const token = data.token;
check("set-pin: returns session token", res.ok && typeof token === "string");

res = await fetch(`${base}?op=info`);
data = await res.json();
check("info: now protected", data.pinProtected === true);

// 4. WS without token — must be rejected with 4401
ws = await wsResult(`${WS}://${HOST}/parties/pad-room/${slug}`);
check("ws: rejected without token (4401)", ws.kind === "close" && ws.code === 4401, JSON.stringify(ws));

// 5. WS with token — allowed
ws = await wsResult(`${WS}://${HOST}/parties/pad-room/${slug}?token=${token}`);
check("ws: allowed with token", ws.kind === "open", ws.kind);

// 6. verify wrong PIN → 403; right PIN → token
res = await fetch(`${base}?op=verify-pin`, {
  method: "POST",
  body: JSON.stringify({ pin: "9999" }),
});
check("verify-pin: wrong PIN rejected", res.status === 403);

// 6b. malformed JSON → 400, not a crash
res = await fetch(`${base}?op=verify-pin`, { method: "POST", body: "{nope" });
check("verify-pin: malformed JSON rejected (400)", res.status === 400);

// 6c. brute-force backoff: repeated failures get throttled (429).
// 6 total failures → a 2s window, wide enough to outlast WAN latency.
for (let i = 0; i < 5; i++) {
  await fetch(`${base}?op=verify-pin`, {
    method: "POST",
    body: JSON.stringify({ pin: "0000" }),
  });
}
res = await fetch(`${base}?op=verify-pin`, {
  method: "POST",
  body: JSON.stringify({ pin: "1234" }),
});
check("verify-pin: throttled after repeated failures (429)", res.status === 429);

// wait out the backoff window (2s if the retry path above ran), then the
// right PIN works
await new Promise((r) => setTimeout(r, 2500));
res = await fetch(`${base}?op=verify-pin`, {
  method: "POST",
  body: JSON.stringify({ pin: "1234" }),
});
data = await res.json();
check("verify-pin: correct PIN grants token", res.ok && typeof data.token === "string");

// 7. read-only token: unauthorized without session, works with it
res = await fetch(`${base}?op=ro-token`);
check("ro-token: rejected without auth", res.status === 401);

res = await fetch(`${base}?op=ro-token&token=${token}`);
data = await res.json();
const roToken = data.token;
check("ro-token: granted with auth", res.ok && typeof roToken === "string");

ws = await wsResult(`${WS}://${HOST}/parties/pad-room/${slug}?ro=${roToken}`);
check("ws: read-only token connects", ws.kind === "open", ws.kind);

ws = await wsResult(`${WS}://${HOST}/parties/pad-room/${slug}?ro=wrong`);
check("ws: bad read-only token rejected (4403)", ws.kind === "close" && ws.code === 4403, JSON.stringify(ws));

// 7b. rotate the read-only token: old link dies, new one works
res = await fetch(`${base}?op=ro-token`, { method: "POST" });
check("ro-token rotate: rejected without auth", res.status === 401);

res = await fetch(`${base}?op=ro-token&token=${token}`, { method: "POST" });
data = await res.json();
const newRoToken = data.token;
check(
  "ro-token rotate: mints a different token",
  res.ok && typeof newRoToken === "string" && newRoToken !== roToken,
);

ws = await wsResult(`${WS}://${HOST}/parties/pad-room/${slug}?ro=${roToken}`);
check("ws: old read-only token rejected after rotate (4403)", ws.kind === "close" && ws.code === 4403, JSON.stringify(ws));

ws = await wsResult(`${WS}://${HOST}/parties/pad-room/${slug}?ro=${newRoToken}`);
check("ws: rotated read-only token connects", ws.kind === "open", ws.kind);

// 7c. reserved slugs (policy pages) can never become pads
ws = await wsResult(`${WS}://${HOST}/parties/pad-room/terms`);
check("ws: reserved slug rejected (4400)", ws.kind === "close" && ws.code === 4400, JSON.stringify(ws));

// 8. snapshots list (requires auth on a pinned pad)
res = await fetch(`${base}?op=snapshots&token=${token}`);
data = await res.json();
check("snapshots: lists (empty ok)", res.ok && Array.isArray(data));

// 9. remove PIN
res = await fetch(`${base}?op=set-pin&token=${token}`, {
  method: "POST",
  body: JSON.stringify({ remove: true }),
});
check("set-pin: remove works", res.ok);

// 10. OG tags for crawlers
res = await fetch(`${HTTP}://${HOST}/${slug}`, {
  headers: { "user-agent": "Twitterbot/1.0" },
});
const html = await res.text();
check("og: crawler gets meta tags", res.ok && html.includes("og:title"));

res = await fetch(`${HTTP}://${HOST}/reserved-check-${slug}`, {
  headers: { "user-agent": "Mozilla/5.0", "sec-fetch-mode": "navigate" },
});
check("spa: humans get the app shell", res.ok && (await res.text()).includes("root"));

// ADR-0011: a missing hashed chunk must 404 and must never be the SPA shell.
// public/_headers stamps /assets/* immutable for a year, so HTML served here
// would be cached as JavaScript long after the deploy that caused it. The
// `!/assets/*` exclusion means the asset router answers this without invoking
// the Worker, so the 404 is a bare one — an empty cached 404 is the accepted
// cost of keeping asset serving free. What must hold is only that it is not
// HTML. This has to run against a real server: the Workers-runtime test calls
// the Worker entrypoint directly and cannot prove what the routing in
// wrangler.jsonc actually returns to a client.
res = await fetch(`${HTTP}://${HOST}/assets/not-a-real-build-chunk.js`);
const missingAsset = await res.text();
check(
  "assets: missing hashed chunk 404s instead of serving the SPA shell",
  res.status === 404 &&
    !(res.headers.get("content-type") ?? "").includes("text/html") &&
    !missingAsset.toLowerCase().includes("<!doctype") &&
    !missingAsset.includes('id="root"'),
  `status=${res.status} type=${res.headers.get("content-type")} len=${missingAsset.length}`,
);

// 11. admin surface (ADR-0010, ADR-0018): room admin ops and the moderation
// ledger are both invisible without the secret…
res = await fetch(`${base}?op=admin-info`);
data = await res.json();
check(
  "admin: unauthenticated room op looks like unknown-op (404)",
  res.status === 404 && data.error === "unknown-op",
);
res = await fetch(`${HTTP}://${HOST}/api/admin/cases`);
data = await res.json().catch(() => ({}));
check(
  "ledger: unauthenticated request looks like unknown-op (404)",
  res.status === 404 && data.error === "unknown-op",
);

// …and, when the secret resolves, the full takedown lifecycle through the
// ledger. Its case is opened as category "other" and closed at the end, so a
// production run leaves a recognizable, closed record rather than an open one.
if (adminSecret && !noAdmin) {
  const Y = await import("yjs");
  const encoding = await import("lib0/encoding.js");
  const adminSlug = `smoke-admin-${Math.random().toString(36).slice(2, 8)}`;
  const adminBase = `${HTTP}://${HOST}/parties/pad-room/${adminSlug}`;
  const headers = { authorization: `Bearer ${adminSecret}` };
  const ledger = (path, method = "GET", body) =>
    fetch(`${HTTP}://${HOST}/api/admin${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  res = await fetch(`${adminBase}?op=admin-info`, { headers });
  data = await res.json().catch(() => ({}));
  check(
    "admin: room op refused on the public route even with the secret",
    res.status === 404 && data.error === "unknown-op",
    `status=${res.status}`,
  );

  // Write real content over the Yjs sync protocol (message: sync/update).
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("document");
  const el = new Y.XmlElement("paragraph");
  el.insert(0, [new Y.XmlText("REPORTED-CONTENT-SMOKE")]);
  frag.insert(0, [el]);
  const update = Y.encodeStateAsUpdate(doc);
  await new Promise((resolve) => {
    const sock = new WebSocket(`${WS}://${HOST}/parties/pad-room/${adminSlug}`);
    sock.binaryType = "arraybuffer";
    const bail = setTimeout(() => {
      sock.close();
      resolve();
    }, 8000);
    // Wait for the server's syncStep1 so onConnect has finished authorizing.
    sock.addEventListener("message", () => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0); // messageSync
      encoding.writeVarUint(enc, 2); // update
      encoding.writeVarUint8Array(enc, update);
      sock.send(encoding.toUint8Array(enc));
      setTimeout(() => {
        clearTimeout(bail);
        sock.close();
        resolve();
      }, 500);
    });
    sock.addEventListener("error", () => {});
  });
  // Persistence is debounced (2s); wait it out before inspecting.
  await new Promise((r) => setTimeout(r, 3500));

  res = await ledger("/cases", "POST", {
    slug: adminSlug,
    kind: "violation",
    source: "other",
    category: "other",
    description: "api-smoke takedown lifecycle",
  });
  data = await res.json().catch(() => ({}));
  check("ledger: case opened", res.status === 201 && Number.isInteger(data.case?.id), `status=${res.status}`);
  const caseId = data.case?.id;
  const act = (action, extra = {}) =>
    ledger(`/cases/${caseId}/actions`, "POST", { action, ...extra });

  res = await act("review");
  data = await res.json().catch(() => ({}));
  check(
    "review: sees content through the ledger",
    res.ok && data.result?.text?.includes("REPORTED-CONTENT-SMOKE") && data.result.docBytes > 0,
    JSON.stringify({ docBytes: data.result?.docBytes, snapshots: data.result?.snapshots }),
  );
  check("review: snapshot history exists", data.result?.snapshots >= 1);
  check(
    "review: intent and outcome recorded",
    data.actions?.map((action) => action.outcome).join() === "pending,ok",
  );

  res = await act("block");
  check("block: refused without a reason", res.status === 400, `status=${res.status}`);

  res = await act("block", { reason: "api-smoke" });
  check("block: accepted", res.ok, `status=${res.status}`);

  res = await fetch(`${adminBase}?op=info`);
  data = await res.json();
  check("blocked: public info reports removed", res.ok && data.removed === true);

  ws = await wsResult(`${WS}://${HOST}/parties/pad-room/${adminSlug}`);
  check("blocked: ws refused (4404)", ws.kind === "close" && ws.code === 4404, JSON.stringify(ws));

  res = await act("unblock", { reason: "api-smoke" });
  check("unblock: accepted", res.ok, `status=${res.status}`);

  ws = await wsResult(`${WS}://${HOST}/parties/pad-room/${adminSlug}`);
  check("unblocked: ws connects again", ws.kind === "open", ws.kind);

  res = await act("purge", { reason: "api-smoke", block: true });
  check("purge: accepted", res.ok, `status=${res.status}`);

  res = await ledger(`/pads/${adminSlug}`);
  data = await res.json().catch(() => ({}));
  check(
    "purged: doc and snapshots wiped, block survives",
    res.ok && data.result?.docBytes === 0 && data.result?.snapshots === 0 && data.result?.blocked !== null,
    JSON.stringify({ docBytes: data.result?.docBytes, snapshots: data.result?.snapshots, blocked: data.result?.blocked }),
  );

  ws = await wsResult(`${WS}://${HOST}/parties/pad-room/${adminSlug}`);
  check("purged+blocked: ws refused (4404)", ws.kind === "close" && ws.code === 4404, JSON.stringify(ws));

  // Leave no blocked smoke pads or open smoke cases behind.
  res = await act("unblock", { reason: "api-smoke cleanup" });
  check("cleanup: unblocked", res.ok);
  res = await act("close", { reason: "api-smoke cleanup" });
  data = await res.json().catch(() => ({}));
  check("cleanup: case closed", res.ok && data.case?.status === "closed");

  res = await ledger("/actions/verify");
  data = await res.json().catch(() => ({}));
  check("ledger: action log chain intact", res.ok && data.ok === true, JSON.stringify(data));
} else if (noAdmin) {
  console.log("SKIP admin lifecycle — --no-admin was passed");
} else {
  check(
    "admin: takedown lifecycle is runnable",
    false,
    "no ADMIN_SECRET in the environment or .dev.vars — set it, or pass --no-admin to leave the takedown surface untested on purpose",
  );
}

const summary = failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`;
console.log(noAdmin ? `${summary} (admin lifecycle skipped)` : summary);
process.exit(failures === 0 ? 0 : 1);
