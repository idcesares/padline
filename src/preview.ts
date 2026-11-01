// Markdown preview. Parses with the same Lezer grammar the editor highlights
// with, so what is colored in the editor is what is rendered here. Output is
// built with DOM calls and textContent only: pad text is public and
// anyone-writable, so it is never parsed as HTML.

import { markdownLanguage } from "@codemirror/lang-markdown";

type Node = ReturnType<typeof markdownLanguage.parser.parse>["topNode"];

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, parent: ParentNode): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  parent.appendChild(node);
  return node;
};

const children = (node: Node): Node[] => {
  const out: Node[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
};

const isMark = (name: string) => name.endsWith("Mark") || name === "TaskMarker" || name === "TableDelimiter";

/** Range of a link or image label: between the first two bracket marks, so the destination is never rendered as text. */
function label(node: Node): [number, number] {
  const marks = children(node).filter((c) => c.name === "LinkMark");
  return marks.length >= 2 ? [marks[0].to, marks[1].from] : [node.from, node.to];
}

/** Strips whitespace the grammar leaves around a block's inline content. */
function trimEdges(parent: HTMLElement): void {
  const first = parent.firstChild;
  if (first?.nodeType === 3) first.textContent = (first.textContent ?? "").replace(/^\s+/, "");
  const last = parent.lastChild;
  if (last?.nodeType === 3) last.textContent = (last.textContent ?? "").replace(/\s+$/, "");
}

function decodeEntity(raw: string): string {
  const box = document.createElement("textarea");
  box.innerHTML = raw.replace(/</g, "&lt;");
  return box.value;
}

function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw.trim(), location.origin);
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function anchor(parent: ParentNode, href: string | null): HTMLElement {
  if (!href) return el("span", parent);
  const a = el("a", parent);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer nofollow ugc";
  return a;
}

function inline(parent: HTMLElement, node: Node, src: string, from = node.from, to = node.to): void {
  let pos = from;
  const text = (end: number) => {
    if (end > pos) parent.appendChild(document.createTextNode(src.slice(pos, end)));
  };
  for (const child of children(node)) {
    if (child.to <= from || child.from >= to) continue;
    text(child.from);
    pos = child.to;
    const name = child.name;
    if (isMark(name)) continue;
    switch (name) {
      case "Emphasis":
        inline(el("em", parent), child, src);
        break;
      case "StrongEmphasis":
        inline(el("strong", parent), child, src);
        break;
      case "Strikethrough":
        inline(el("del", parent), child, src);
        break;
      case "InlineCode": {
        const marks = children(child).filter((c) => c.name === "CodeMark");
        const start = marks[0]?.to ?? child.from;
        const end = marks[marks.length - 1]?.from ?? child.to;
        el("code", parent).textContent = src.slice(start, end);
        break;
      }
      case "Link": {
        // The destination is the URL after the closing bracket, not one inside the label.
        const close = children(child).filter((c) => c.name === "LinkMark")[1];
        const url = children(child).find((c) => c.name === "URL" && (!close || c.from >= close.to));
        const a = anchor(parent, url ? safeHref(src.slice(url.from, url.to)) : null);
        inline(a, child, src, ...label(child));
        break;
      }
      case "Image":
        // Images are not supported (ADR-0001); show the alt text.
        inline(el("span", parent), child, src, ...label(child));
        break;
      case "Autolink":
      case "URL": {
        const raw = src.slice(child.from, child.to).replace(/^<|>$/g, "");
        // Bare www. and email autolinks have no scheme; without one they would resolve against this site.
        const target = /^www\./i.test(raw)
          ? `https://${raw}`
          : /^[^\s@:/]+@[^\s@:/]+\.[^\s@:/]+$/.test(raw)
            ? `mailto:${raw}`
            : raw;
        const a = anchor(parent, safeHref(target));
        a.textContent = raw;
        break;
      }
      case "URLPart":
      case "LinkTitle":
      case "LinkLabel":
        break;
      case "HardBreak":
        el("br", parent);
        break;
      case "Escape":
        parent.appendChild(document.createTextNode(src.slice(child.from + 1, child.to)));
        break;
      case "Entity":
        parent.appendChild(document.createTextNode(decodeEntity(src.slice(child.from, child.to))));
        break;
      default:
        // HTMLTag and anything unknown: literal text, never markup.
        if (child.firstChild) inline(el("span", parent), child, src);
        else parent.appendChild(document.createTextNode(src.slice(child.from, child.to)));
    }
  }
  text(to);
}

function block(parent: HTMLElement, node: Node, src: string): void {
  const name = node.name;
  const heading = /^(?:ATXHeading|SetextHeading)([1-6])$/.exec(name);
  if (heading) {
    const h = el(`h${heading[1]}` as "h1", parent);
    inline(h, node, src);
    trimEdges(h);
    return;
  }
  switch (name) {
    case "Paragraph": {
      const p = el("p", parent);
      inline(p, node, src);
      trimEdges(p);
      return;
    }
    case "Blockquote": {
      const q = el("blockquote", parent);
      blocks(q, node, src);
      return;
    }
    case "BulletList":
    case "OrderedList": {
      const list = el(name === "BulletList" ? "ul" : "ol", parent);
      if (name === "OrderedList") {
        const first = node.getChild("ListItem")?.getChild("ListMark");
        const n = first ? Number.parseInt(src.slice(first.from, first.to), 10) : 1;
        if (Number.isFinite(n) && n !== 1) (list as HTMLOListElement).start = n;
      }
      for (const item of children(node)) if (item.name === "ListItem") listItem(list, item, src);
      return;
    }
    case "FencedCode":
    case "CodeBlock": {
      const lines = children(node).filter((c) => c.name === "CodeText");
      const code = el("code", el("pre", parent));
      // The pieces already carry their own line breaks.
      code.textContent = lines.map((c) => src.slice(c.from, c.to)).join("").replace(/\n$/, "");
      return;
    }
    case "HorizontalRule":
      el("hr", parent);
      return;
    case "Table":
      table(parent, node, src);
      return;
    case "LinkReference":
      return;
    default: {
      // HTMLBlock, comments and anything else: shown as literal text.
      if (isMark(name)) return;
      const p = el("p", parent);
      p.textContent = src.slice(node.from, node.to).trim();
    }
  }
}

function blocks(parent: HTMLElement, node: Node, src: string): void {
  for (const child of children(node)) if (!isMark(child.name)) block(parent, child, src);
}

function listItem(list: HTMLElement, item: Node, src: string): void {
  const li = el("li", list);
  for (const child of children(item)) {
    if (isMark(child.name)) continue;
    if (child.name === "Task") {
      const marker = child.getChild("TaskMarker");
      li.className = "task";
      if (marker && /x/i.test(src.slice(marker.from, marker.to))) li.classList.add("done");
      const box = el("span", li);
      box.className = "cb";
      box.setAttribute("aria-hidden", "true");
      const body = el("span", li);
      inline(body, child, src);
      trimEdges(body);
      continue;
    }
    block(li, child, src);
  }
}

/** A row's cells in column order. The grammar emits no node for an empty cell, so segment by the pipes: `null` is an empty cell. */
function cells(row: Node, src: string): (Node | null)[] {
  const kids = children(row);
  const pipes = kids.filter((c) => c.name === "TableDelimiter");
  const bounds = [row.from, ...pipes.flatMap((p) => [p.from, p.to]), row.to];
  const out: (Node | null)[] = [];
  for (let i = 0; i < bounds.length; i += 2) {
    const [from, to] = [bounds[i], bounds[i + 1]];
    const cell = kids.find((c) => c.name === "TableCell" && c.from >= from && c.to <= to) ?? null;
    // Text before the first pipe or after the last is a cell only if it has content.
    const edge = i === 0 || i === bounds.length - 2;
    if (edge && !cell && src.slice(from, to).trim() === "") continue;
    out.push(cell);
  }
  return out;
}

function table(parent: HTMLElement, node: Node, src: string): void {
  const wrap = el("div", parent);
  wrap.className = "tbl";
  const t = el("table", wrap);
  const rows = children(node).filter((c) => c.name === "TableHeader" || c.name === "TableRow");
  rows.forEach((row) => {
    const isHead = row.name === "TableHeader";
    const tr = el("tr", isHead ? el("thead", t) : (t.tBodies[0] ?? el("tbody", t)));
    for (const cell of cells(row, src)) {
      const td = el(isHead ? "th" : "td", tr);
      if (cell) inline(td, cell, src);
      trimEdges(td);
    }
  });
}

/** Replaces `target`'s content with the rendered Markdown of `text`. */
export function renderPreview(target: HTMLElement, text: string): void {
  try {
    const tree = markdownLanguage.parser.parse(text);
    const out = document.createDocumentFragment() as unknown as HTMLElement;
    blocks(out, tree.topNode, text);
    target.replaceChildren(out);
  } catch {
    // Pathologically nested input can overflow the stack; show it as plain text.
    target.textContent = text;
  }
}
