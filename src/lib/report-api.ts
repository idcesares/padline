export type ReportKind = "violation" | "removal-request" | "appeal";

export type ReportSubmission = {
  pad: string;
  kind: ReportKind;
  category: string;
  description: string;
  contact: string;
  turnstileToken: string;
};

export type ReportOutcome =
  | { ok: true; reference: string }
  | { ok: false; error: string };

/** The instance's public Turnstile site key; null when reporting is not set up. */
export async function fetchReportConfig(): Promise<{ siteKey: string | null }> {
  const res = await fetch("/api/reports/config");
  if (!res.ok) throw new Error("report-config-failed");
  return res.json();
}

/** ADR-0018: the same 202 for every well-formed report, whatever the pad's state. */
export async function submitReport(report: ReportSubmission): Promise<ReportOutcome> {
  try {
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
    });
    const data = (await res.json().catch(() => ({}))) as {
      reference?: unknown;
      error?: unknown;
    };
    if (res.status === 202 && typeof data.reference === "string") {
      return { ok: true, reference: data.reference };
    }
    return {
      ok: false,
      error: typeof data.error === "string" ? data.error : `http-${res.status}`,
    };
  } catch {
    return { ok: false, error: "network" };
  }
}
