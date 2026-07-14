# ADR-0001: React 19 SPA with Tailwind v4 + shadcn/ui

**Status:** accepted (2026-07-14)

## Context

The original proposal suggested vanilla Vite + minimal CSS. The product goal was raised to "beautiful, modern UI (shadcn-quality)". shadcn/ui is React-only. The UI chrome (share dialog, PIN dialog, history panel, presence avatars) is exactly shadcn's sweet spot, while the perf-critical surface — the editor — is the editor library's own DOM, untouched by React rendering.

## Decision

React 19 + Vite (plain SPA, no SSR framework) + React Router + Tailwind v4 + shadcn/ui. The Worker serves static assets; OG tags for link previews are produced by Hono intercepting crawler user-agents on `/:slug` (~30 lines), not by SSR.

## Consequences

- shadcn-quality UI with near-zero custom design work.
- No SSR pipeline to maintain; content is realtime-synced client-side anyway.
- React's overhead never touches the hot editing path (Yjs state lives outside React).

## Rejected

- Vanilla TS (hand-building dialogs/popovers/focus traps contradicts "simple for the builder").
- TanStack Start / framework-mode SSR (drags in a server-rendering pipeline only to render OG tags we can emit from Hono).
- Svelte/Solid + shadcn ports (ports lag upstream; thinner Yjs/editor ecosystem).
