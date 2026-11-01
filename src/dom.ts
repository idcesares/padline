// Tiny DOM helpers shared by the views. No framework (ADR-0001).

export function $<T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** An <svg> that points at a symbol in the sprite inside index.html. */
export function icon(name: string, size?: number): string {
  const dim = size ? ` style="width:${size}px;height:${size}px"` : "";
  return `<svg class="ic"${dim} aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

/**
 * Copies text. Resolves true on success, false when the clipboard is not
 * available (older apps, permissions), so callers can fall back to selection.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Shows `msg` in the view's toast element for a moment. */
export function makeToast(el: HTMLElement): (msg: string) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (msg) => {
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      el.hidden = true;
    }, 1800);
  };
}
