// Smoke test for the PadRoom HTTP/WS surface. Requires the dev server.
const arg = process.argv[2] ?? "127.0.0.1:8788";
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

// 11. admin surface (ADR-0010): invisible without the secret…
res = await fetch(`${base}?op=admin-info`);
data = await res.json();
check(
  "admin: unauthenticated op looks like unknown-op (404)",
  res.status === 404 && data.error === "unknown-op",
);

// …and, when ADMIN_SECRET is provided, the full takedown lifecycle.
if (process.env.ADMIN_SECRET) {
  const Y = await import("yjs");
  const encoding = await import("lib0/encoding.js");
  const adminSlug = `smoke-admin-${Math.random().toString(36).slice(2, 8)}`;
  const adminBase = `${HTTP}://${HOST}/parties/pad-room/${adminSlug}`;
  const headers = { authorization: `Bearer ${process.env.ADMIN_SECRET}` };
  const admin = (op, method = "POST", body) =>
    fetch(`${adminBase}?op=${op}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

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

  res = await admin("admin-info", "GET");
  data = await res.json();
  check(
    "admin-info: sees content through the surface",
    res.ok && data.text.includes("REPORTED-CONTENT-SMOKE") && data.docBytes > 0,
    JSON.stringify({ docBytes: data.docBytes, snapshots: data.snapshots }),
  );
  check("admin-info: snapshot history exists", data.snapshots >= 1);

  res = await admin("admin-block", "POST", { reason: "smoke test" });
  check("admin-block: accepted", res.ok);

  res = await fetch(`${adminBase}?op=info`);
  data = await res.json();
  check("blocked: public info reports removed", res.ok && data.removed === true);

  ws = await wsResult(`${WS}://${HOST}/parties/pad-room/${adminSlug}`);
  check("blocked: ws refused (4404)", ws.kind === "close" && ws.code === 4404, JSON.stringify(ws));

  res = await admin("admin-unblock");
  check("admin-unblock: accepted", res.ok);

  ws = await wsResult(`${WS}://${HOST}/parties/pad-room/${adminSlug}`);
  check("unblocked: ws connects again", ws.kind === "open", ws.kind);

  res = await admin("admin-purge", "POST", { block: true, reason: "smoke test" });
  check("admin-purge: accepted", res.ok);

  res = await admin("admin-info", "GET");
  data = await res.json();
  check(
    "purged: doc and snapshots wiped, block survives",
    res.ok && data.docBytes === 0 && data.snapshots === 0 && data.blocked !== null,
    JSON.stringify({ docBytes: data.docBytes, snapshots: data.snapshots, blocked: data.blocked }),
  );

  ws = await wsResult(`${WS}://${HOST}/parties/pad-room/${adminSlug}`);
  check("purged+blocked: ws refused (4404)", ws.kind === "close" && ws.code === 4404, JSON.stringify(ws));

  // Leave no blocked smoke pads behind.
  res = await admin("admin-unblock");
  check("cleanup: unblocked", res.ok);
} else {
  console.log("SKIP admin lifecycle (set ADMIN_SECRET to run it)");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
