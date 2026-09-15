/**
 * The moderation profile: every moderation value that encodes one
 * jurisdiction's rules rather than Padline's mechanism (ADR-0018).
 *
 * These values are padline.page's, assessed for its operator — an individual
 * in Brazil, with no economic purpose — under Brazilian law as understood on
 * `assessedAt`, without review by counsel. They are not a compliance claim for
 * any other instance. A fork replaces this profile after its own assessment;
 * see docs/operating-a-public-instance.md.
 *
 * Category ids are stored in the moderation ledger, so they are stable
 * identifiers: a profile may add categories or change which are grave, but
 * must not rename an id that stored cases already use.
 */
export type ModerationProfile = {
  jurisdiction: string;
  label: string;
  assessedAt: string;
  operatorContact: string;
  categories: Record<string, { grave: boolean }>;
  reviewTargetHours: { grave: number; standard: number };
  evidenceRetentionDays: number;
  reporterContactRetentionDays: number;
};

export const MODERATION_PROFILE = {
  jurisdiction: "BR",
  label: "Brazil — padline.page operator (individual, non-commercial)",
  assessedAt: "2026-09-13",
  operatorContact: "contact@padline.page",
  categories: {
    // Grave: the content the STF's 2026 art. 19 thesis names for a duty of
    // care against systemic failure, reviewed first.
    "child-sexual-exploitation": { grave: true },
    terrorism: { grave: true },
    "violence-incitement": { grave: true },
    "human-trafficking": { grave: true },
    "anti-democratic": { grave: true },
    "phishing-malware": { grave: false },
    "harassment-doxxing": { grave: false },
    copyright: { grave: false },
    defamation: { grave: false },
    privacy: { grave: false },
    spam: { grave: false },
    other: { grave: false },
  },
  reviewTargetHours: { grave: 24, standard: 72 },
  evidenceRetentionDays: 180,
  reporterContactRetentionDays: 180,
} as const satisfies ModerationProfile;

export type ReportCategory = keyof typeof MODERATION_PROFILE.categories;

export type CasePriority = "grave" | "standard";

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === "string" && Object.hasOwn(MODERATION_PROFILE.categories, value);
}

export function priorityOf(category: ReportCategory): CasePriority {
  return MODERATION_PROFILE.categories[category].grave ? "grave" : "standard";
}
