// Smoke test: can we complete a WebSocket handshake with a pad's room?
const url = process.argv[2] ?? "ws://127.0.0.1:8788/parties/pad-room/smoke-test";

const ws = new WebSocket(url);
const timeout = setTimeout(() => {
  console.error("FAIL: timed out waiting for WebSocket open");
  process.exit(1);
}, 10000);

ws.addEventListener("open", () => {
  clearTimeout(timeout);
  console.log("OK: WebSocket connected to", url);
  ws.close();
  process.exit(0);
});
ws.addEventListener("error", () => {
  clearTimeout(timeout);
  console.error("FAIL: WebSocket error connecting to", url);
  process.exit(1);
});
