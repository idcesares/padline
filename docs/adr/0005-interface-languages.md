# ADR-0005: Interface languages

**Status:** accepted (2026-11-01). Widens the copy decision in ADR-0001
("copy in PT-BR and EN").

## Context

The interface shipped in Portuguese (Brazil) and English, picked with a
two-button switch. More languages were wanted without a framework or a
dependency.

## Decision

- Six languages, all left-to-right: English, Portuguese (Brazil), Spanish,
  French, German, Italian. The list is `LANGS` in `src/prefs.ts`.
- English is the source table. Every other table is typed against its keys, so
  a missing or extra key fails `tsc` (`npm run build`). There is no runtime
  parity test: the test project has no DOM, and the type check is stricter.
- First visit: the first entry of `navigator.languages` whose base language is
  supported, else English. A stored choice wins; an unknown stored value is
  ignored.
- The picker is a native `<select>` showing each language in its own name.
  Six segmented buttons do not fit the menu at 320px. This departs from the
  mockup, which only drew two.
- Dates and relative times use `Intl` with the language's BCP 47 tag
  (Portuguese is `pt-BR`).
- Right-to-left languages (Arabic, Hebrew) are out of scope: they need mirrored
  layout, not just strings.
- The link preview served to crawlers (`worker/index.ts`) and `index.html`
  stay English. The Worker never reads the pad, and a crawler has no stored
  choice.

## Consequences

- A new language is one table, one entry in `LANGS`, `LOCALE` and
  `LANG_NAMES`.
- Translations are drafts until a native speaker reads them
  (`docs/backlog.md`).
- Language is chosen from the editor menu only. The landing, About and report
  pages follow the stored choice or the browser, and have no picker of their
  own.
