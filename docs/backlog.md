# Backlog before the first deploy

What is known to be unfinished or unchecked. Remove an item when it is done.

## Manual checks still pending

None of these has been done in a browser; there is no browser test suite.
Check against [the mockup](design/mockup.html) by eye.

- Preview: Edit/Preview toggle, headings, lists, tasks, links, tables (including empty cells), code blocks, light and dark theme.
- About page and the footer links.
- Share dialog: keyboard (Tab cycle, Esc, focus returns to the opener) and a screen reader (the QR announces as "QR code for <address>").
- QR scanning with a phone camera. The matrix was decoded in Node from the same generator output (two addresses, both decoded); the rendered tile has not been scanned.
- Mobile widths (375 and 320): bar, preview toggle, share sheet with the QR.

## Known gaps

- `src/preview.ts` and `src/qr.ts` have no automated tests (the suite runs in workerd, without a DOM).
- The preview shows single line breaks as breaks, unlike strict Markdown. Deliberate.
- On mobile the preview is one toggle button, not the mockup's segmented control.
- The request body is not drained on a 403 and on non-JSON input to the admin and report endpoints.
- The admin page shows its generic error for a `404` or `409` from the API; the buttons are already disabled in the normal cases.
- No test distinguishes the `content-length` check on `/api/report` from the body-length check after it.

## Before the first deploy

Each needs an explicit go-ahead from the operator.

- [done 2026-11-01] Cloudflare Access app `padline-admin` covers `/admin` and `/api/admin/*`; `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` set in `wrangler.jsonc` and deployed 2026-11-01. Policy allows `dcesares.dev@gmail.com` and `dcesares.zarac@gmail.com`.
- [done 2026-11-01] Old Worker secrets removed (`ADMIN_SECRET`, `TURNSTILE_*`); `wrangler secret list` is empty.
- [done 2026-11-01] Edge rate-limit on /api/report (2 req / 10s per IP, Block 10s; free-plan max window). Replaced Leaked credential check to free the 1/1 slot.
