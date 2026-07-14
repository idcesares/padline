const ADJECTIVES = [
  "amber", "brisk", "calm", "dapper", "eager", "fuzzy", "gentle", "happy",
  "ivory", "jolly", "keen", "lively", "mellow", "nimble", "opal", "plucky",
  "quiet", "rosy", "sunny", "tidy", "vivid", "witty", "zesty", "bold",
];

const ANIMALS = [
  "otter", "fox", "heron", "lynx", "panda", "quail", "raven", "seal",
  "tapir", "urchin", "vole", "wren", "yak", "zebra", "bison", "crane",
  "dingo", "egret", "ferret", "gecko", "ibis", "koala", "lemur", "mole",
];

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set(["api", "assets", "parties", "p", "r", "admin"]);

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug);
}

/** ADR-0004: unguessable-by-default, human-readable slugs. */
export function randomSlug(): string {
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
  const n = Math.floor(Math.random() * 90) + 10;
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
