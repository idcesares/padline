# ADR-0002: BlockNote block editor (a pad is a lightweight Notion page)

**Status:** accepted (2026-07-14)

## Context

The proposal specified CodeMirror 6 (plain text/Markdown) and excluded rich block editing. Ambitions were raised: the editor is 90% of the product surface and should feel like a beautiful modern 2026 app.

## Decision

BlockNote (ProseMirror/Tiptap-based Notion-style block editor) with its first-class Yjs collaboration (cursors, presence, offline merge), slash commands, drag handles, and shadcn-compatible theming. V1 enables text blocks only (headings, lists, code blocks, tables); image/file blocks are disabled (see ADR-0007).

## Consequences

- The product identity shifts from "a URL that is a text file" to "a URL that is a lightweight Notion page". Accepted deliberately.
- Document state is structured blocks, not plain text; raw-text access is served by Markdown export (BlockNote's built-in serializer).
- Heavier bundle than CodeMirror; acceptable for the UX gained.

## Rejected

- CodeMirror 6 with live Markdown styling (beautiful requires substantial custom extension work; out of the box it reads as a code editor).
- Both editors with per-pad choice (double editor-integration work; not v1 material).
