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

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
