// ADR-0003: flat slugs, shared by the client and the Worker so both sides
// agree on what a pad address is.

export const SLUG_MAX_LENGTH = 64;

/** Paths the app owns. A pad can never take one of these (ADR-0002, ADR-0003). */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "api",
  "parties",
  "admin",
  "report",
  "about",
  "assets",
  "static",
  "favicon",
  "robots",
  "sitemap",
  "index",
]);

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Turns whatever a visitor typed into the address it would open as: accents
 * folded, spaces and underscores to hyphens, everything else dropped, repeated
 * and edge hyphens trimmed, at most 64 characters. May return "".
 */
export function normalizeSlug(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, "");
}

export type SlugCheck = "ok" | "invalid" | "reserved";

/** Checks an already-normalized slug. */
export function checkSlug(slug: string): SlugCheck {
  if (slug.length < 1 || slug.length > SLUG_MAX_LENGTH) return "invalid";
  if (!SLUG_PATTERN.test(slug)) return "invalid";
  if (RESERVED_SLUGS.has(slug)) return "reserved";
  return "ok";
}

export const isValidSlug = (slug: string): boolean => checkSlug(slug) === "ok";

const ADJECTIVES = [
  "mellow", "quiet", "brisk", "amber", "lucky", "sunny", "tidy", "velvet",
  "swift", "gentle", "bold", "calm", "cozy", "dapper", "eager", "fuzzy",
  "jolly", "keen", "lively", "nimble", "plucky", "rosy", "witty", "zesty",
];

const NOUNS = [
  "otter", "heron", "falcon", "maple", "pebble", "comet", "lemon", "harbor",
  "willow", "finch", "lynx", "panda", "raven", "seal", "wren", "crane",
  "gecko", "koala", "lemur", "marmot", "puffin", "tern", "walrus", "yak",
];

/** `mellow-otter-42` style. Not secret: pads are public (ADR-0001). */
export function randomSlug(): string {
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${10 + Math.floor(Math.random() * 90)}`;
}
