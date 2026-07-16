import { useEffect, type ReactNode } from "react";
import { Link } from "react-router";
import { PenLine } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { ThemeToggle } from "@/components/theme-toggle";

const LAST_UPDATED = "July 16, 2026";
const CONTACT = "isaac.dcesares@gmail.com";
const REPO = "https://github.com/idcesares/padline";

/** Shared minimal layout for policy pages: header, prose, footer. */
function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const { theme, toggleTheme } = useTheme();
  useEffect(() => {
    document.title = `${title} — Padline`;
    return () => {
      document.title = "Padline";
    };
  }, [title]);
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b bg-background/80 px-4 backdrop-blur">
        <Link to="/" viewTransition className="flex items-center gap-2 font-medium">
          <PenLine className="size-4" aria-hidden />
          <span>Padline</span>
        </Link>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Last updated: {LAST_UPDATED}
        </p>
        <div className="mt-8 space-y-8">{children}</div>
      </main>
      <footer className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-4 gap-y-1 px-6 pb-8 text-sm text-muted-foreground">
        <Link to="/terms" className="hover:text-foreground">Terms</Link>
        <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
        <Link to="/content-policy" className="hover:text-foreground">Content Policy</Link>
        <a href={REPO} className="hover:text-foreground">Source</a>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">{title}</h2>
      <div className="space-y-3 leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export function Terms() {
  return (
    <LegalPage title="Terms of Use">
      <Section title="The service">
        <p>
          Padline is a free, real-time collaborative notepad. Visiting a URL
          opens (or creates) a pad; anyone with that URL can read and edit it
          unless a PIN is set. By using Padline you agree to these terms, to
          the <Link to="/privacy" className="underline underline-offset-4">Privacy Policy</Link>,
          and to the <Link to="/content-policy" className="underline underline-offset-4">Content Policy</Link>.
        </p>
      </Section>
      <Section title="Pads are open by design">
        <p>
          A pad's URL is its only identity. Anyone who knows or guesses a URL
          can access that pad. A PIN adds protection, but Padline offers no
          accounts and no recovery — if you lose a PIN or share a URL, we
          cannot undo that. Do not use Padline for secrets, credentials, or
          anything you cannot afford to expose.
        </p>
      </Section>
      <Section title="Your content">
        <p>
          You own what you write. You are responsible for the content of pads
          you create or edit, and you must have the right to post what you
          post. We claim no ownership over pad content and use it only to
          operate the service.
        </p>
      </Section>
      <Section title="Fair use">
        <p>
          Padline enforces technical limits (document size, connections,
          message rates) to keep the service healthy. Attempting to bypass
          them, to disrupt the service, or to access pads by circumventing
          PINs or read-only restrictions is prohibited.
        </p>
      </Section>
      <Section title="No warranty">
        <p>
          Padline is provided <em>as is</em>, without warranty of any kind.
          It runs on a free tier with no uptime or durability guarantees —
          export anything you care about (every pad has Markdown export). To
          the maximum extent permitted by law, we are not liable for any loss
          arising from your use of the service.
        </p>
      </Section>
      <Section title="Enforcement & changes">
        <p>
          We may remove content or restrict access to pads that violate the
          Content Policy or applicable law, and we may update these terms as
          the service evolves — the date above always reflects the current
          version. Material changes will be visible in the{" "}
          <a href={REPO} className="underline underline-offset-4">public repository</a>.
        </p>
      </Section>
      <Section title="Contact">
        <p>
          Questions: <a href={`mailto:${CONTACT}`} className="underline underline-offset-4">{CONTACT}</a>
        </p>
      </Section>
    </LegalPage>
  );
}

export function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <Section title="Our commitment">
        <p>
          Padline is built to know as little about you as possible. There are
          no accounts, no sign-ups, no tracking pixels, no analytics scripts,
          no advertising, and no cookies. We never sell data — there is
          essentially no data about <em>you</em> to sell.
        </p>
      </Section>
      <Section title="What we store">
        <p>
          <strong className="text-foreground">Pad content</strong> — what you
          write is stored on Cloudflare's network (Durable Objects) so it can
          be shared and synced. Automatic snapshots (up to 100 per pad) enable
          history restore.
        </p>
        <p>
          <strong className="text-foreground">PINs</strong> — stored only as
          salted PBKDF2 hashes; we cannot read your PIN back.
        </p>
        <p>
          <strong className="text-foreground">Your identity</strong> — the
          display name and color shown to collaborators is generated locally
          and lives in your browser's localStorage. It is shared only with
          people in the same pad, only while you're connected, and is never
          tied to a real identity.
        </p>
      </Section>
      <Section title="What stays on your device">
        <p>
          Visited pads are cached in your browser (IndexedDB) for offline
          resilience, along with your display name and theme preference.
          Clearing your browser storage removes all of it.
        </p>
      </Section>
      <Section title="What we technically process">
        <p>
          Like any website, requests pass through our infrastructure provider
          (Cloudflare), which processes IP addresses to deliver the site and
          to enforce rate and connection limits that protect pads from abuse.
          We do not build profiles from this and operational logs are
          short-lived.
        </p>
      </Section>
      <Section title="Search engines">
        <p>
          Pad pages are served with a <code className="text-foreground">noindex</code>{" "}
          directive: your pads are not meant to appear in search engines. Only
          this landing site is indexable.
        </p>
      </Section>
      <Section title="Your control">
        <p>
          You can export any pad to Markdown at any time, and you can delete a
          pad's content by simply clearing it. For removal requests or any
          privacy question, write to{" "}
          <a href={`mailto:${CONTACT}`} className="underline underline-offset-4">{CONTACT}</a>.
        </p>
      </Section>
    </LegalPage>
  );
}

export function ContentPolicy() {
  return (
    <LegalPage title="Content Policy">
      <Section title="The short version">
        <p>
          Padline is a shared notepad, not a shield. Don't use it to harm
          people or break the law.
        </p>
      </Section>
      <Section title="Not allowed">
        <ul className="list-disc space-y-2 pl-5">
          <li>Content that is illegal, or that facilitates illegal activity</li>
          <li>Child sexual abuse material — reported to authorities, zero tolerance</li>
          <li>Malware, phishing pages, or credential harvesting</li>
          <li>Harassment, threats, or doxxing (publishing someone's private information)</li>
          <li>Spam or platform abuse (mass-created pads, link farms, evading limits)</li>
          <li>Content that infringes copyright or other rights you don't hold</li>
        </ul>
      </Section>
      <Section title="Enforcement">
        <p>
          Pads violating this policy may be cleared or made inaccessible, and
          the abuse limits that protect the service may be tightened against
          offending sources. Padline is open by design, so moderation is
          reactive — we act on what is reported to us.
        </p>
      </Section>
      <Section title="Reporting">
        <p>
          To report a pad, email{" "}
          <a href={`mailto:${CONTACT}`} className="underline underline-offset-4">{CONTACT}</a>{" "}
          with the pad's URL and what's wrong. Copyright holders should
          include enough detail to identify the work.
        </p>
      </Section>
    </LegalPage>
  );
}
