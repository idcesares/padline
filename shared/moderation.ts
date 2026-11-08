// ADR-0002: the short fixed list of categories and the input caps, shared by
// the report page, the admin page, the Worker and the removed notice so they
// can never disagree.

export const CATEGORIES = [
  "spam",
  "scam",
  "illegal",
  "harassment",
  "personal",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const isCategory = (value: unknown): value is Category =>
  typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);

/** A report's free-text note. Describes the problem; is not a place to paste the pad. */
export const NOTE_MAX = 280;

/** An optional way to reach the reporter. */
export const CONTACT_MAX = 120;

/** The admin's filters over the pad index. */
export const ADMIN_FILTERS = ["recent", "largest", "active", "reported", "blocked"] as const;
export type AdminFilter = (typeof ADMIN_FILTERS)[number];

/** Rows the admin list returns at most. The page says so when a list hits it. */
export const ADMIN_LIST_LIMIT = 50;

/** Characters of a pad the admin page shows. Read live from the room, never stored. */
export const EXCERPT_CHARS = 600;
