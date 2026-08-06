# ADR-0013: Route-owned browser pad sessions with real-browser verification

**Status:** accepted (2026-08-05)

## Context

Opening a pad requires one coordinated browser lifecycle: resolve URL access,
preflight PIN protection, persist an edit session, recover when it expires,
apply a read-only-link capability, cache the Yjs document in IndexedDB, connect
the Room provider, and react if the pad is removed. This behavior was split
between the pad route, the HTTP client, share dialog, and history sheet.

The split caused duplicate pad-info requests and made session tokens part of
several rendering interfaces. It also let the mounted Room provider capture an
old token: adding PIN protection kept the current socket alive, but a later
automatic reconnect attempted the old capability and returned to the PIN
prompt.

The Workers-runtime suite proves the Room HTTP and WebSocket interface, but it
cannot execute localStorage, IndexedDB, React, BlockNote, or the browser Room
provider. A DOM-only runner would need substitutes for the exact platform
behavior this lifecycle coordinates.

## Decision

- A route-level `PadSession` module owns access resolution, edit-session token
  storage, PIN transitions, expired-session recovery, Y.Doc and IndexedDB
  lifetime, Room provider lifetime, readiness, and takedown transitions.
- Its external interface is the pad slug plus an optional read-only-link token.
  Rendering modules receive resolved state and capability commands; they do not
  receive or persist raw session tokens.
- Room connection parameters are resolved dynamically. Setting or removing a
  PIN does not interrupt the active socket, while any later reconnect uses the
  current capability.
- Playwright characterizes the public `/:slug` URL against the real local
  Worker in Chromium. Server preconditions use the Room's actual HTTP
  interface; no pad-session or runtime mock adapter is introduced.
- Workers Vitest remains scoped to `test/**/*.test.ts`; browser tests live under
  `e2e/` and run separately with `npm run test:e2e`.

## Consequences

- Token and resource lifecycle changes are local to one deep module instead of
  requiring coordinated edits across rendering modules.
- The PIN preflight still occurs before an edit Room requests document bytes;
  read-only links remain capabilities and bypass that prompt.
- Browser tests cover fresh pads, PIN grant and persistence, reconnect with a
  changed capability, expired sessions, read-only links, and takedown notices
  through user-visible behavior.
- Contributors install Playwright's Chromium build in addition to npm packages.
  Browser artifacts live outside the repository so Vite does not reload the
  app while a lifecycle test is observing it.

## Rejected

- **Keep token-aware rendering modules.** This preserves the scattered
  lifecycle knowledge and makes future access changes shotgun surgery.
- **Expose a broad reusable session hook.** There is one route consumer; a
  larger public interface would move details without hiding them.
- **Add a framework-neutral controller or mock adapter.** There is no second
  production adapter, so this would create a hypothetical seam.
- **Use jsdom component tests.** Substituting IndexedDB, WebSocket, the Room
  provider, and BlockNote would test the substitutes rather than Padline's
  browser lifecycle.

## Related

ADR-0003 (Room collaboration), ADR-0004 (URL-first pads), ADR-0005 (PIN and
read-only capabilities), ADR-0009 (session expiry), ADR-0010 (takedown), and
ADR-0011 (Cloudflare-native verification).
