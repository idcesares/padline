# ADR-0017: The editor surface is inside the design system, not beside it

**Status:** accepted (2026-08-08)

Extends ADR-0001 (React SPA with shadcn/ui) and ADR-0002 (BlockNote) to the
seam between them. Neither is contradicted; both left the boundary unspecified.

## Context

ADR-0001 adopted shadcn/ui and ADR-0002 adopted BlockNote, but nothing said
which of them owns the pixels *inside* the editor. In practice neither did, and
three defects grew in the gap. All three were reproduced against a running dev
server and measured in the live DOM.

**Links rendered at 2.11:1.** `@blocknote/shadcn` ships
`.bn-shadcn .bn-editor a { color: revert; text-decoration: revert }`. `revert`
rolls a property back to the *user-agent* stylesheet, so pad links were literally
`#0000EE` on the `#0a0a0a` ground — a WCAG AA failure, and six times weaker than
the body text beside them at 12.71:1.

**Selection was unstyled.** The app defined no `::selection` rule anywhere, so
selection highlight was the browser default and the one part of the interface
that ignored the theme entirely.

**The formatting toolbar was painted over by the header.** Not a clipping or
positioning bug. The editor's reveal wrapper carried `translate-y-0`; in
Tailwind v4 that compiles to the independent `translate` property, whose computed
value is `0px` — not `none`. Any `translate` but `none` creates a stacking
context, so the wrapper became one at `z-index: auto` and trapped every floating
BlockNote surface (the toolbar sits at `z-40`) beneath the sticky header at
`z-10`. A high z-index inside a low stacking context cannot escape it.

The same gap showed on the app side of the seam: four header controls hand-rolled
a class string that reimplemented `<Button variant="ghost" size="icon-sm">`,
which already existed. The duplication had drifted — only one of the four had
open-state feedback, and none inherited the system's `ring-[3px]` focus
treatment.

## Decision

**Padline's tokens win inside the editor.** `--link` and `--selection` join the
token set in `index.css`, and the editor's link and selection rules are defined
against them rather than left to whatever a dependency reverts to.

**The link rule is qualified `a[href]` deliberately.** BlockNote's rule has
identical specificity and ships in the pad route's CSS chunk, so it loads *after*
`index.css` and wins on source order. The attribute selector raises specificity
without `!important`, and is honest: it targets actual links. Verified — the
unqualified rule applied `text-underline-offset` but lost `color`.

**`--link` is the palette's only chroma.** Every other token is achromatic
(chroma `0`), which is right for a writing tool and is not being overturned.
Links earn the exception by being the only genuinely clickable thing in a pad.
Values are tuned per theme rather than shared: `oklch(0.5 0.19 255)` at 6.06:1 on
white, `oklch(0.78 0.13 245)` at 9.9:1 on the dark ground. The underline sits at
45% and resolves to full on hover, so the link is identifiable at rest and
confirms itself under the cursor.

**No `translate` at rest.** The reveal keeps `translate-y-1` only while
un-`ready`; the translate is what the fade-in needs, and holding it afterwards
buys nothing while permanently creating the stacking context. Z-order alone was
not sufficient — with `py-8` the toolbar still resolved inside the 48px header,
so the editor's top padding grew to `pt-16` to give it somewhere to go.

**`Button` is the only source of an app control's shape.** The four header
triggers and both landing-page buttons compose it via `asChild`.

## Consequences

- Link contrast went from 2.11:1 to 9.9:1 (dark) and 6.06:1 (light); both pass
  WCAG AA, dark passes AAA.
- Floating BlockNote UI — toolbar, link editor, side menu, slash menu, all at
  z-index 20–90 — now resolves above the `z-10` header, verified by hit-testing
  the overlap region rather than by reading the screenshot.
- Header controls gained uniform open-state feedback and the system focus ring.
- A future `translate-*`, `scale-*`, `rotate-*`, `filter`, or `opacity` utility
  on any ancestor of the editor will re-create this bug. The wrapper carries a
  comment saying so. This is the failure mode to check first if floating editor
  UI ever disappears again.
- The status line (see `.scratch/status-line/spec.md`) now hosts the sync
  indicator, and the header renders its dot only while the status line is
  hidden. The CONTEXT.md invariant that a sync indicator is always visible still
  holds, but it is now satisfied by two surfaces rather than one.
- Eight e2e tests asserted on the old header dot's `aria-label`
  (`Sync status: connected`) and were updated to a shared `expectConnected`
  helper matching `role="status"`. One of them additionally had to close the
  share dialog before asserting: while a Radix dialog is open the rest of the
  page is `aria-hidden`, so role-based queries cannot see the status line.
- Connection state is carried by `--status-ok` / `--status-warn` /
  `--status-error`, tuned per theme like `--link` rather than shared across
  both. Every value is inside the sRGB gamut and clears WCAG 1.4.11's 3:1 bar
  for non-text UI against `--background` — 4.56 / 3.30 / 5.39 light, 8.60 /
  10.41 / 6.82 dark, confirmed in the browser in both themes.

## Rejected

- **`!important` on the link rule.** Works, but starts an escalation with the
  dependency and hides the real cause, which is stylesheet order.
- **Reordering the imports so BlockNote's CSS loads before `index.css`.** The
  import lives in a route component and Vite chunks route CSS separately;
  the fix would depend on bundler behaviour that no test would pin.
- **Forking or patching `@blocknote/shadcn`.** Far too much surface area owned
  to fix two declarations.
- **Raising `--bn-ui-base-z-index` above the header.** Treats the symptom. The
  toolbar's `z-40` was already higher than the header's `z-10`; the problem was
  the stacking context, so raising the number changes nothing.
- **Giving the reveal wrapper a z-index above the header.** It would lift the
  entire editor subtree over the header, so body text would scroll *over* the
  bar instead of under it.
- **Neutral links (foreground + underline, Notion-style).** Contrast is
  excellent and it preserves the achromatic palette, but it removes colour as a
  signal of interactivity from a product that then has none anywhere.
- **Reusing Tailwind's `emerald-500` / `amber-500` / `red-500`** for status.
  They are fixed values with no per-theme variant, so the dot would have kept
  ignoring the theme — the original complaint. Semantic state is also a separate
  axis from `--link`: one reports a condition, the other invites a click, and
  collapsing them would make an offline pad look clickable.
- **Deriving status hues from `--link`.** Tempting for palette coherence, but
  green, amber, and red carry conventional meaning that a blue-derived ramp
  destroys.

## Related

ADR-0001 (shadcn/ui as the component system), ADR-0002 (BlockNote as the
editor), ADR-0011 (Cloudflare-native verification — the e2e suite updated here),
ADR-0013 (route-owned pad session, which owns the header and reveal wrapper),
and `.scratch/status-line/spec.md`.
