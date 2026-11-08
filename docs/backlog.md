# Backlog before the first deploy

What is known to be unfinished or unchecked. Remove an item when it is done.

## Manual checks still pending

There is no browser test suite. Check against [the mockup](design/mockup.html) by eye.

Checked 2026-11-01 in the in-app browser against the local dev server (PT, desktop and phone widths; no Playwright run):

- [done] Preview: toggle, headings, nested lists, tasks, links, tables with empty cells, code blocks, light and dark theme.
- [done] About page and footer links (Report, About; "Source" opens GitHub with `noopener noreferrer`).
- [done] Share dialog keyboard: Tab cycles URL, Copy, Close; Esc closes; focus returns to the Share button. ARIA is present (`role=dialog`, `aria-modal`, labelled; the QR is `role=img` with "Código QR de <address>").
- [done] Mobile 375 and 320: bar fits, no horizontal overflow, preview toggle works, share sheet with the QR fits.

Still open:

- Screen reader pass (only the ARIA markup was inspected, nothing was announced).
- The remaining theme and size combinations from the mockup.
- Not exercised in EN: the blocked/removed, pad-full, offline and server-error states (they need server-side setup). Their strings exist in both tables.

Also checked 2026-11-01:

- [done] QR scanned with a phone camera (by the operator): opens the pad.
- [done] EN locale: editor, More menu, share dialog (including the QR's accessible name), About, report form and its reasons, landing hints (slug folding, reserved word, 64-char cap). The EN and PT tables have the same 123 keys, and no accented literals sit outside `src/i18n.ts`.
- Mobile bar touch targets are 44px (hit area, not visual size, via `::after` in the narrow container query in `src/style.css`); the slug button is vertical-only because it flexes to whatever width is left. The share dialog's own buttons (Copy, Close) were not changed.

## Languages (ADR-0005)

- Spanish, French, German and Italian are machine-drafted and have not been read by native speakers. Get that review before the next deploy that ships them. Points to check: German uses "Pad" (neuter) and informal "du"; Spanish and French use "bloc"; the report reasons and the Admin strings.
- Checked 2026-11-01 in the in-app browser at 320px: the More menu in all six languages (French "Système" needed tighter theme-button padding, scoped to `html[lang="fr"]`; re-measure if that scoped rule is changed), share dialog, report form and About in German, the choice surviving a reload, an invalid stored value falling back to the browser language.
- Also checked 2026-11-01 at 320px: landing (with its slug, reserved-word and 64-char hints), About and report in ES, FR and IT; landing hints in DE and PT; the admin page in all six languages. No horizontal overflow, except the admin list tabs in ES and PT (PT predates the languages), which were clipped; they now wrap onto two rows (`.ahead .seg` in `src/style.css`). The admin check ran on the local dev server, whose D1 has no migrations applied, so the list showed its error state, not rows; the admin table with data and the pad detail pane were not checked in the new languages.
- The picker is a `<select>`, not the mockup's segmented control (six buttons do not fit at 320px). The mockup was not updated.
- Language can only be changed from the editor menu. The landing, About and report pages have no picker.
- Not localized: the crawler link preview (`worker/index.ts`) and the static meta tags in `index.html`. Right-to-left languages are deferred.

## Admin view pass (2026-11-08)

Stays inside the ADR-0002 cap: counts and a fifth list filter, no cases, exports, bulk actions, evidence or new categories.

- New: `blocked` filter, `GET /api/admin/counts` and tab badges, refresh button, "N shown" footer (says when the 50-row cap is hit), size meter against the 1 MiB cap, copy-address button, exact time on hover, date and time plus an action chip in the log, click a log slug to select that pad, success message after each action, keyboard (`/` search, up and down move the selection when focus is in the list and no confirm is open, Esc cancels a confirm), sticky detail pane on wide screens, a loading state, and a guard against stale search responses.
- Fixed: `aria-selected` on `<tr>` (invalid) is now `aria-current` on the row button; search no longer reloads the detail and log.
- Diverges from `docs/design/mockup.html` (not updated): tab count badges, refresh button, size meters, copy button, footer line, sticky detail.
- 15 new `a.*` strings in all six languages. ES, FR, DE and IT join the native-review debt above.
- Checked in the in-app browser against a seeded local D1: 320px in all six languages (no overflow, tabs wrap), light and dark, 1280px two-column layout with the sticky detail, block, dismiss, Esc cancel, arrow keys, `/`, blocked filter, and live counts. Clear was not exercised in the browser (the room is empty on the dev server); it has integration tests. `npm test` (53) and `npm run build` pass. A failed detail request (error state in the pane) was not triggered in the browser. The sticky pane was checked by computed style only, not by scrolling a tall list.

## Known gaps

- `src/preview.ts` and `src/qr.ts` have no automated tests (the suite runs in workerd, without a DOM).
- The preview shows single line breaks as breaks, unlike strict Markdown. Deliberate.
- On mobile the preview is one toggle button, not the mockup's segmented control.

## Before the first deploy

Each needs an explicit go-ahead from the operator.

- [done 2026-11-01] Cloudflare Access app `padline-admin` covers `/admin` and `/api/admin/*`; `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` set in `wrangler.jsonc` and deployed 2026-11-01. Policy allows `dcesares.dev@gmail.com` and `dcesares.zarac@gmail.com`.
- [done 2026-11-01] Old Worker secrets removed (`ADMIN_SECRET`, `TURNSTILE_*`); `wrangler secret list` is empty.
- [done 2026-11-01] Edge rate-limit on /api/report (2 req / 10s per IP, Block 10s; free-plan max window). Replaced Leaked credential check to free the 1/1 slot.
