# ADR-0006: Snapshot history in v1 (idle-triggered, pruned, restore-as-edit)

**Status:** accepted (2026-07-14)

## Context

An anonymous public editor will eventually get a pad wiped. History is the difference between annoying and catastrophic — it's the feature that makes the product trustworthy.

## Decision

The room saves a compact Yjs snapshot on an idle trigger (~30s after edits stop), keeping ~100 in its SQLite with spaced pruning (recent dense, then hourly, then daily). UI: a history panel (shadcn Sheet) listing timestamps — click to preview, one button to restore. **Restore applies the snapshot as a new edit** (itself undoable), never a destructive rollback.

## Rejected

- No history in v1 (retrofitting snapshots is easy; retrofitting trust isn't).
- Full per-edit timeline with diffs/attribution (real work; attribution is meaningless among anonymous users; snapshot history doesn't block it later).
