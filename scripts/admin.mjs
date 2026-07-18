// Moderation CLI for the PadRoom admin surface (ADR-0010).
//
// Usage:
//   ADMIN_SECRET=... node scripts/admin.mjs <host> <slug> info
//   ADMIN_SECRET=... node scripts/admin.mjs <host> <slug> block [--reason "..."]
//   ADMIN_SECRET=... node scripts/admin.mjs <host> <slug> unblock
//   ADMIN_SECRET=... node scripts/admin.mjs <host> <slug> purge [--block] [--reason "..."]
//
// <host> examples: 127.0.0.1:8788, https://padline.page
//
// info    — metadata + content preview (works through a PIN)
// block   — pad refuses all access; visitors see the removed screen
// unblock — lift a block
// purge   — wipe doc, snapshots, PIN, sessions, read-only token;
//           --block also blocks the slug so it can't be refilled

const [arg, slug, action] = process.argv.slice(2);
const secret = process.env.ADMIN_SECRET;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

if (!arg || !slug || !["info", "block", "unblock", "purge"].includes(action)) {
  die(
    "Usage: ADMIN_SECRET=... node scripts/admin.mjs <host> <slug> <info|block|unblock|purge> [--block] [--reason \"...\"]",
  );
}
if (!secret) die("ADMIN_SECRET is not set.");

const flags = process.argv.slice(5);
const block = flags.includes("--block");
const reasonIdx = flags.indexOf("--reason");
const reason = reasonIdx >= 0 ? flags[reasonIdx + 1] : undefined;

const isLocal = /^(localhost|127\.)/.test(arg);
const origin = arg.startsWith("http")
  ? arg
  : `${isLocal ? "http" : "https"}://${arg}`;
const base = `${origin.replace(/\/$/, "")}/parties/pad-room/${slug}`;

const requests = {
  info: { op: "admin-info", method: "GET" },
  block: { op: "admin-block", method: "POST", body: { reason } },
  unblock: { op: "admin-unblock", method: "POST", body: {} },
  purge: { op: "admin-purge", method: "POST", body: { block, reason } },
};

const { op, method, body } = requests[action];
const res = await fetch(`${base}?op=${op}`, {
  method,
  headers: { authorization: `Bearer ${secret}` },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const data = await res.json().catch(() => null);
if (res.status === 404 && data?.error === "unknown-op") {
  die(
    "Rejected as unknown-op: wrong ADMIN_SECRET, or the secret is not deployed on this host.",
  );
}
if (!res.ok) die(`HTTP ${res.status}: ${JSON.stringify(data)}`);

if (action === "info") {
  const { text, ...meta } = data;
  console.log(JSON.stringify(meta, null, 2));
  console.log(
    text
      ? `\n--- content preview ---\n${text}`
      : "\n(no persisted content)",
  );
} else {
  console.log(JSON.stringify(data, null, 2));
}
