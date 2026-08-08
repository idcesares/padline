import { useEffect, useState } from "react";
import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from "@blocknote/core";

/** Words per minute used for the reading estimate — the common prose average. */
const READING_WPM = 200;

/** Recounting the whole document on every keystroke stutters on large pads. */
const RECOUNT_DELAY_MS = 200;

export type PadStats = {
  words: number;
  characters: number;
  /** Blocks carrying text. "Lines" would be a wrap artifact, not a document fact. */
  blocks: number;
  readingMinutes: number;
};

export type PadSelection = {
  words: number;
  characters: number;
};

const EMPTY_STATS: PadStats = {
  words: 0,
  characters: 0,
  blocks: 0,
  readingMinutes: 0,
};

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

/**
 * Flattens one block's inline content. Text sits in `text` nodes, links wrap
 * their own `content`, and tables nest cells one level deeper again.
 */
function inlineText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(inlineText).join("");

  if (content && typeof content === "object") {
    const node = content as Record<string, unknown>;
    if (node.type === "text" && typeof node.text === "string") return node.text;
    if ("content" in node) return inlineText(node.content);
    if (Array.isArray(node.rows)) {
      return (node.rows as Array<{ cells?: unknown }>)
        .map((row) => inlineText(row.cells))
        .join("");
    }
  }

  return "";
}

/** Takes the block list rather than the editor — schema-agnostic and directly testable. */
function computeStats(document: readonly unknown[]): PadStats {
  let words = 0;
  let characters = 0;
  let blocks = 0;

  const visit = (list: readonly unknown[]): void => {
    for (const entry of list) {
      const block = entry as { content?: unknown; children?: unknown[] };
      const text = inlineText(block.content);

      if (text.trim()) {
        blocks += 1;
        words += countWords(text);
        characters += text.length;
      }

      if (Array.isArray(block.children) && block.children.length > 0) {
        visit(block.children);
      }
    }
  };

  visit(document);

  return {
    words,
    characters,
    blocks,
    readingMinutes: words > 0 ? Math.max(1, Math.round(words / READING_WPM)) : 0,
  };
}

/**
 * Live document statistics for the status line.
 *
 * Document totals are debounced because they walk every block; the selection
 * readout is not, because it is a single cheap call and lag there reads as jank.
 * Both stay unsubscribed entirely while the status line is hidden.
 */
export function usePadStats<
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>(
  editor: BlockNoteEditor<BSchema, ISchema, SSchema>,
  enabled: boolean,
): { stats: PadStats; selection: PadSelection | null } {
  const [stats, setStats] = useState<PadStats>(EMPTY_STATS);
  const [selection, setSelection] = useState<PadSelection | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const recountSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setStats(computeStats(editor.document)), RECOUNT_DELAY_MS);
    };

    // Remote edits move the counts too, so this intentionally keeps the
    // includeUpdatesFromRemote default.
    setStats(computeStats(editor.document));
    const unsubscribeChange = editor.onChange(recountSoon);

    return () => {
      clearTimeout(timer);
      unsubscribeChange?.();
    };
  }, [editor, enabled]);

  useEffect(() => {
    if (!enabled) return;

    const readSelection = () => {
      const text = editor.getSelectedText();
      setSelection(
        text
          ? { words: countWords(text), characters: text.length }
          : null,
      );
    };

    readSelection();
    const unsubscribeSelection = editor.onSelectionChange(readSelection);

    return () => unsubscribeSelection?.();
  }, [editor, enabled]);

  return { stats, selection };
}
