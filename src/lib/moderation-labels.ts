import type { ReportCategory } from "./moderation-profile";

/**
 * Plain-language names for report categories, shown on the report form and in
 * a removed pad's statement of reasons. Keyed by the moderation profile's ids,
 * so a fork that adds a category has to name it here too.
 */
export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  "child-sexual-exploitation": "Child sexual exploitation",
  terrorism: "Terrorism",
  "violence-incitement": "Incitement to violence or self-harm",
  "human-trafficking": "Human trafficking",
  "anti-democratic": "Attacks on democratic institutions",
  "phishing-malware": "Phishing or malware",
  "harassment-doxxing": "Harassment or doxxing",
  copyright: "Copyright infringement",
  defamation: "Defamation",
  privacy: "Privacy violation",
  spam: "Spam or platform abuse",
  other: "Other Content Policy violation",
};

export function categoryLabel(id: string | undefined): string | null {
  return id && Object.hasOwn(CATEGORY_LABELS, id)
    ? CATEGORY_LABELS[id as ReportCategory]
    : null;
}
