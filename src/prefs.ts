// Everything the app remembers about a visitor lives on their device
// (ADR-0001, ADR-0003): theme, language, identity, recently opened pads.
// localStorage can throw or come back empty (private windows, blocked site
// data), so every access is wrapped and the app works without it.

export type Lang = "en" | "pt";
export type Theme = "system" | "light" | "dark";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the preference lasts until reload */
  }
}

// ---------- language ----------

let lang: Lang | null = null;

export function getLang(): Lang {
  if (lang) return lang;
  const stored = read("padline:lang");
  if (stored === "en" || stored === "pt") lang = stored;
  else lang = navigator.language?.toLowerCase().startsWith("pt") ? "pt" : "en";
  return lang;
}

export function setLang(next: Lang): void {
  lang = next;
  write("padline:lang", next);
}

// ---------- theme ----------

export function getTheme(): Theme {
  const stored = read("padline:theme");
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function applyTheme(theme: Theme = getTheme()): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function setTheme(theme: Theme): void {
  write("padline:theme", theme);
  applyTheme(theme);
}

// ---------- identity (presence only, not an account) ----------

/** Light-theme values of the mockup's --p1..--p5, as hex so Yjs awareness can carry them. */
export const PALETTE = ["#B45309", "#0B7A70", "#6D3FD0", "#C2255C", "#0B6FA8"] as const;

export type Identity = { name: string; color: string };

const ID_ADJ = ["Amber", "Teal", "Violet", "Coral", "Indigo", "Olive", "Rose", "Slate", "Sage", "Plum"];
const ID_ANIMAL = ["Fox", "Heron", "Finch", "Otter", "Lynx", "Wren", "Seal", "Crane", "Hare", "Newt"];

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

export function getIdentity(): Identity {
  const raw = read("padline:identity");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Identity>;
      if (typeof parsed.name === "string" && typeof parsed.color === "string") {
        return { name: parsed.name, color: parsed.color };
      }
    } catch {
      /* fall through to a fresh identity */
    }
  }
  const identity = { name: `${pick(ID_ADJ)} ${pick(ID_ANIMAL)}`, color: pick(PALETTE) };
  write("padline:identity", JSON.stringify(identity));
  return identity;
}

// ---------- recent pads ----------

export type Recent = { slug: string; at: number };

const RECENT_MAX = 8;

export function getRecent(): Recent[] {
  const raw = read("padline:recent");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is Recent =>
          typeof r?.slug === "string" && typeof r?.at === "number",
      )
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function touchRecent(slug: string): void {
  const rest = getRecent().filter((r) => r.slug !== slug);
  write("padline:recent", JSON.stringify([{ slug, at: Date.now() }, ...rest].slice(0, RECENT_MAX)));
}
