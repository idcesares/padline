import { randomSlug } from "./slug";

export type Identity = {
  name: string;
  color: string;
};

/** Curated presence palette — readable on light and dark backgrounds. */
const COLORS = [
  "#e11d48", "#ea580c", "#ca8a04", "#16a34a",
  "#0d9488", "#0284c7", "#7c3aed", "#c026d3",
];

const STORAGE_KEY = "padline:identity";

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** ADR: identity is a toy, not a system — generated once, editable, local. */
export function getIdentity(): Identity {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Identity;
      if (parsed.name && parsed.color) return parsed;
    } catch {
      // fall through to regenerate
    }
  }
  const [adjective, animal] = randomSlug().split("-");
  const identity: Identity = {
    name: `${titleCase(adjective)} ${titleCase(animal)}`,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function saveIdentity(identity: Identity): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}
