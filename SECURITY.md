# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via [GitHub Security Advisories](https://github.com/idcesares/padline/security/advisories/new) (preferred) or by email to **isaac.dcesares@gmail.com** with `[padline security]` in the subject.

Include what you found, how to reproduce it, and the impact you believe it has. You'll get an acknowledgment as soon as possible, and a fix or a clear response before any public disclosure is expected.

**This process is for security vulnerabilities in the code** (auth bypass, XSS, escaping a cap, etc). A report about a specific pad's *content* — CSAM, harassment, spam, copyright — is a Content Policy matter, not a vulnerability: see [README § Moderation](README.md#moderation-takedowns) for the takedown runbook. Both land in the same inbox, so triage by content, not by which page the reporter used.

## Scope & security model

Padline's model is documented in the ADRs — the most relevant:

- [ADR-0005](docs/adr/0005-pin-gates-everything-readonly-links.md) — PIN gates everything server-side; read-only links are capability URLs
- [ADR-0008](docs/adr/0008-abuse-invariants-only-in-v1.md) — abuse invariants (size/connection/message caps)
- [ADR-0009](docs/adr/0009-brute-force-and-token-lifetime-hardening.md) — PIN brute-force backoff, session TTL, token rotation, CSP

**Known, accepted tradeoffs** (not vulnerabilities — by design, documented in ADR-0009):

- Anyone can visit an unprotected pad and set a PIN on it (first-claimer-wins; inherent to the no-account model).
- Pads without a PIN are readable/editable by anyone who knows the URL — that's the product. Random slugs are hard to guess (~20M combinations) but are not secrets; use a PIN for confidentiality.
- Session and read-only tokens travel in URL query parameters.

Reports demonstrating a way to **bypass a PIN**, **write through a read-only link**, **read a pad's content without its URL**, or **escape the abuse caps** are always in scope and very welcome.
