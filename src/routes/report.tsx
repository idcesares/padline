import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { CATEGORY_LABELS } from "@/lib/moderation-labels";
import { MODERATION_PROFILE, type ReportCategory } from "@/lib/moderation-profile";
import { fetchReportConfig, submitReport, type ReportKind } from "@/lib/report-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LegalPage } from "./legal";

const CONTACT = MODERATION_PROFILE.operatorContact;
const DESCRIPTION_MAX = 2000;
const CONTACT_MAX = 254;

const KINDS: Array<{ value: ReportKind; label: string; hint: string }> = [
  {
    value: "violation",
    label: "Report a pad",
    hint: "It breaks the Content Policy or the law.",
  },
  {
    value: "removal-request",
    label: "Remove my own content",
    hint: "You wrote it and want it gone.",
  },
  {
    value: "appeal",
    label: "Appeal a removal",
    hint: "A pad was removed and you think that was wrong.",
  },
];

/** Native select and textarea, styled to match the Input primitive. */
const fieldClass =
  "w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 [&_option]:bg-background";

type Status =
  | { kind: "editing" }
  | { kind: "sending" }
  | { kind: "failed"; message: string }
  | { kind: "sent"; reference: string };

function kindFrom(value: string | null): ReportKind {
  return KINDS.some((option) => option.value === value)
    ? (value as ReportKind)
    : "violation";
}

function messageFor(error: string): string {
  switch (error) {
    case "verification-failed":
      return "The human check didn't go through. Please complete it again.";
    case "invalid-slug":
      return "That doesn't look like a Padline pad. Paste its address, like padline.page/your-pad.";
    case "invalid-category":
      return "Choose what's wrong with the pad.";
    case "invalid-description":
      return `Keep the details under ${DESCRIPTION_MAX.toLocaleString()} characters.`;
    case "invalid-contact":
      return "That email address is too long.";
    default:
      return `Reporting isn't available right now. Please email ${CONTACT}.`;
  }
}

/**
 * ADR-0018: the public report channel. Turnstile is verified by the Worker
 * before anything is stored, and the answer never reveals whether a pad exists.
 */
export default function Report() {
  const [params] = useSearchParams();
  const [pad, setPad] = useState(() => params.get("pad") ?? "");
  const [kind, setKind] = useState<ReportKind>(() => kindFrom(params.get("kind")));
  const [category, setCategory] = useState<ReportCategory | "">("");
  const [description, setDescription] = useState("");
  const [contact, setContact] = useState("");
  // undefined while loading; null when the instance has no site key.
  const [siteKey, setSiteKey] = useState<string | null | undefined>(undefined);
  const [token, setToken] = useState<string | null>(null);
  const [widgetKey, setWidgetKey] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: "editing" });

  useEffect(() => {
    let cancelled = false;
    void fetchReportConfig()
      .then((config) => {
        if (!cancelled) setSiteKey(config.siteKey);
      })
      .catch(() => {
        if (!cancelled) setSiteKey(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onToken = useCallback((next: string | null) => setToken(next), []);

  if (status.kind === "sent") {
    return (
      <LegalPage title="Report received" lede={null}>
        <div className="space-y-3 leading-relaxed text-muted-foreground">
          <p>Thank you — your report was received.</p>
          <p>
            Reference:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
              {status.reference}
            </code>
            . Mention it if you write to us about this report.
          </p>
          <p>We review reports as they arrive, the most serious first.</p>
          <Link to="/" className="inline-block underline underline-offset-4">
            Back to Padline
          </Link>
        </div>
      </LegalPage>
    );
  }

  const needsCategory = kind === "violation";
  const canSend =
    !!token &&
    pad.trim() !== "" &&
    (!needsCategory || category !== "") &&
    status.kind !== "sending";

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setStatus({ kind: "sending" });
    const outcome = await submitReport({
      pad: pad.trim(),
      kind,
      category: needsCategory
        ? category
        : kind === "removal-request"
          ? "privacy"
          : "other",
      description,
      contact,
      turnstileToken: token,
    });
    if (outcome.ok) {
      setStatus({ kind: "sent", reference: outcome.reference });
      return;
    }
    // A Turnstile token is single-use, so any refusal needs a fresh check.
    setToken(null);
    setWidgetKey((key) => key + 1);
    setStatus({ kind: "failed", message: messageFor(outcome.error) });
  };

  return (
    <LegalPage
      title="Report a pad"
      lede={
        <p className="mt-1 text-sm text-muted-foreground">
          Tell us about a pad that breaks the{" "}
          <Link to="/content-policy" className="underline underline-offset-4">
            Content Policy
          </Link>{" "}
          or the law, ask us to remove your own content, or appeal a removal.
        </p>
      }
    >
      <form onSubmit={send} className="space-y-6" noValidate>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">What do you need?</legend>
          {KINDS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-ring"
            >
              <input
                type="radio"
                name="kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
                className="mt-1 accent-primary"
              />
              <span>
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-sm text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="report-pad">Pad address</Label>
          <Input
            id="report-pad"
            value={pad}
            onChange={(event) => setPad(event.target.value)}
            placeholder="padline.page/your-pad"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {needsCategory && (
          <div className="space-y-2">
            <Label htmlFor="report-category">What's wrong</Label>
            <select
              id="report-category"
              className={cn(fieldClass, "h-9 py-1")}
              value={category}
              onChange={(event) => setCategory(event.target.value as ReportCategory | "")}
            >
              <option value="" disabled>
                Choose one
              </option>
              {Object.entries(CATEGORY_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="report-details">Details</Label>
          <textarea
            id="report-details"
            className={cn(fieldClass, "min-h-28")}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={DESCRIPTION_MAX}
          />
          <p className="text-xs text-muted-foreground">
            Optional. What you saw and where on the pad.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="report-contact">Your email</Label>
          <Input
            id="report-contact"
            type="email"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            maxLength={CONTACT_MAX}
            autoComplete="email"
          />
          <p className="text-xs text-muted-foreground">
            Optional, only if you'd like a reply. We keep it at most{" "}
            {MODERATION_PROFILE.reporterContactRetentionDays} days after we
            close your report.
          </p>
        </div>

        {siteKey === undefined ? (
          <p className="text-sm text-muted-foreground">Loading the human check…</p>
        ) : siteKey === null ? (
          <p className="text-sm text-destructive">
            Reporting isn't available right now. Please email{" "}
            <a href={`mailto:${CONTACT}`} className="underline underline-offset-4">
              {CONTACT}
            </a>
            .
          </p>
        ) : (
          <TurnstileWidget key={widgetKey} siteKey={siteKey} onToken={onToken} />
        )}

        {status.kind === "failed" && (
          <p role="alert" className="text-sm text-destructive">
            {status.message}
          </p>
        )}

        <Button type="submit" disabled={!canSend}>
          {status.kind === "sending" ? "Sending…" : "Send report"}
        </Button>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Reports are checked by Cloudflare Turnstile. Padline doesn't store your
          IP address with a report, and sending one doesn't tell you whether a
          pad exists. See the{" "}
          <Link to="/privacy" className="underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </LegalPage>
  );
}

type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      theme: "light" | "dark";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let turnstileScript: Promise<void> | null = null;

/** Loaded on this page only; the CSP admits its origin for script and frame. */
function loadTurnstile(): Promise<void> {
  turnstileScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      turnstileScript = null;
      reject(new Error("turnstile-unavailable"));
    };
    document.head.appendChild(script);
  });
  return turnstileScript;
}

function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let widgetId: string | undefined;
    void loadTurnstile()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId = window.turnstile.render(container.current, {
          sitekey: siteKey,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onToken, siteKey]);

  return <div ref={container} className="min-h-[65px]" />;
}
