# ADR-0012: SEO and Generative Engine Optimization (GEO)

**Status:** accepted (2026-07-18)

## Context

Padline's landing, legal, and pad-share surfaces already carried baseline SEO
(meta description, OG tags, JSON-LD, `humans.txt`, author attribution — PR #2,
2026-07-16). There was no `robots.txt`, `sitemap.xml`, or `llms.txt`, and no
explicit policy on AI answer-engine crawlers (GPTBot, ClaudeBot, PerplexityBot,
Google-Extended, OAI-SearchBot), which now drive citations in ChatGPT, Claude,
Perplexity, and AI-overview search results distinct from classic organic
search. Agent-facing instructions also lived only in `CLAUDE.md`, invisible to
the growing set of tools (Codex, Cursor, Copilot, and others) that read the
Linux-Foundation-stewarded `AGENTS.md` standard instead.

## Decision

- Add `public/robots.txt`: allow all crawlers by default, with explicit
  `Allow: /` entries naming the AI crawlers that drive answer-engine citations
  (GPTBot, OAI-SearchBot, ClaudeBot, anthropic-ai, PerplexityBot,
  Google-Extended) so the policy is a documented decision, not an accident of
  omission. Points to the sitemap.
- Add `public/sitemap.xml` listing only the static, owned pages (`/`, `/terms`,
  `/privacy`, `/content-policy`). Pad slugs are never enumerated — they are
  unlinked, ephemeral, and already served `noindex` OG metadata to the classic
  search/social crawlers matched by `CRAWLER_RE` in `worker/index.ts`.
- Add `public/llms.txt` — a curated, four-part (H1 / blockquote / sections /
  annotated links) map of the product and source docs for LLM agents, per the
  emerging llms.txt convention. It explicitly tells assistants that pad URLs
  are ephemeral user content, not Padline's own documentation, so a crawled
  pad is never mistaken for authoritative product information.
- Extend `index.html`'s existing structured data with a canonical `<link>` and
  `twitter:title`/`twitter:description`, closing small gaps rather than
  replacing what PR #2 already shipped.
- Promote `AGENTS.md` to the canonical, tool-agnostic instruction file (setup
  pointers, verification steps, conventions, machine quirks). `CLAUDE.md`
  becomes a one-line `@AGENTS.md` import so Claude Code loads the same content
  without a second copy to keep in sync.

## Consequences

- One crawler/indexing policy is documented and readable by both humans and
  bots, instead of being implicit in `worker/index.ts`'s `CRAWLER_RE` list.
- Adding a new static page means one more `<url>` in `sitemap.xml`; forgetting
  it only means slower discovery, never an incorrect entry, since nothing
  pad-related is ever listed.
- Agent instructions have one source of truth (`AGENTS.md`); Claude Code can
  still gain Claude-specific notes later without duplicating shared content.

## Rejected

- **Disallowing pad-slug paths in `robots.txt`.** Slugs are an open charset
  (`SLUG_PATTERN`), so a blanket rule would either miss cases or need to
  re-enumerate reserved words already handled by `RESERVED_SLUGS`. Pads are
  already unlinked and `noindex` for the crawlers that would act on it; a
  robots rule would add a second policy surface with no added protection.
- **Blocking training-only crawlers (e.g. CCBot, Bytespider).** Padline is
  MIT-licensed and wants visibility; the only content at stake on the crawled
  surfaces is public marketing/legal copy the project already wants indexed.
  Revisit if this becomes a real concern.
