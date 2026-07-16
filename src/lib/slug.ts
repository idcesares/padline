const ADJECTIVES = [
  "amber", "brisk", "calm", "dapper", "eager", "fuzzy", "gentle", "happy",
  "ivory", "jolly", "keen", "lively", "mellow", "nimble", "opal", "plucky",
  "quiet", "rosy", "sunny", "tidy", "vivid", "witty", "zesty", "bold",
  "airy", "breezy", "cozy", "deft", "dusky", "fabled", "glad", "hardy",
  "hazel", "lucid", "lunar", "maple", "misty", "noble", "peppy", "polar",
  "prim", "quirky", "sable", "sleek", "spry", "stout", "swift", "wry",
];

const ANIMALS = [
  "otter", "fox", "heron", "lynx", "panda", "quail", "raven", "seal",
  "tapir", "urchin", "vole", "wren", "yak", "zebra", "bison", "crane",
  "dingo", "egret", "ferret", "gecko", "ibis", "koala", "lemur", "mole",
  "badger", "bee", "civet", "dove", "eland", "finch", "gnu", "hare",
  "hoopoe", "jay", "kite", "loon", "marmot", "newt", "okapi", "owl",
  "pika", "puffin", "shrew", "skink", "stoat", "swan", "tern", "walrus",
];

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set([
  "api", "assets", "parties", "p", "r", "admin",
  // Policy pages (routed by the SPA, never pads).
  "terms", "privacy", "content-policy", "legal", "about",
]);

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug);
}

/**
 * ADR-0004: hard-to-guess, human-readable slugs.
 * ADR-0009: 48 × 48 × 9000 ≈ 20.7M combinations — enumeration-resistant
 * together with edge rate limiting, though not cryptographically secret.
 */
export function randomSlug(): string {
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
  const n = Math.floor(Math.random() * 9000) + 1000;
  return `${pick(ADJECTIVES)}-${pick(ANIMALS)}-${n}`;
}

/** Normalize arbitrary user input into a slug candidate. */
export function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
