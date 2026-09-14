# ADR-0018: Notice-and-action moderation with a case ledger

**Status:** accepted (2026-09-13) — phase 1 in progress: the moderation
profile, the ledger, the recorded takedown path (room admin operations closed
on the public route), the Turnstile-gated report API, freeze, disconnect, the
statement of reasons on removed pads, evidence capture with retention and
holds, `remove`, bulk actions, totals, and export are implemented; the report
form and operator notification are not yet.

Partially supersedes ADR-0010 (the rejection of an in-app report flow and of
any central moderation store, and the directly reachable `op=admin-*` surface).
Lifts the reporting and admin-tooling deferrals of ADR-0007 and ADR-0008 for
text pads. ADR-0010's core holds: the room stays the authority for enforcement,
and there is still no pad registry.

## Context

**Who carries the responsibility.** Padline is operated by one individual,
in Brazil, with no economic purpose — a free, open-source tool hosted on
Cloudflare and reachable from anywhere. Whatever is published under
`padline.page` is, in practice, that person's legal exposure. That changes the
weight of moderation relative to ADR-0010, which was written for near-zero
report volume and optimized for knowing as little as possible.

**The Brazilian liability regime changed.** None of the following has been
reviewed by counsel; it is the operator's working understanding, recorded so
the design's assumptions are explicit and can be revisited when legal advice is
available. It is specific to Brazil and to this operator's status, and it is
not an assessment for any other instance — see "Jurisdiction is
configuration" below and `docs/operating-a-public-instance.md`.

- In 2025 the STF declared art. 19 of the Marco Civil da Internet (Lei
  12.965/2014) partially unconstitutional (Temas 987/533), and fixed the final
  thesis on 2026-06-17, with a further adjustment in August 2026 that this ADR
  has not been able to read. As understood: for crimes and unlawful acts in
  general, **unjustified inaction after an extrajudicial notice makes the
  provider jointly liable** with the author; art. 19's court-order regime
  remains for offences against honour.
- The provider is excused where it shows **"dúvida razoável quanto à
  ilicitude, após análise diligente e qualificada"**. The defence is a record:
  when the notice arrived, what was examined, what was decided, and why.
- For grave content in mass circulation — child sexual exploitation,
  terrorism, anti-democratic acts, inducement to suicide, violence against
  women, human trafficking — there is a duty of care and liability for
  **systemic failure**, unless the provider proves timely, diligent action.
- Self-regulation duties attach: a reachable notice channel, due process, and
  a representative in Brazil (the operator is).
- ECA Digital (Lei 15.211/2025, in force 2026-03-17) applies to services with
  *probable access* by minors, including obligations to remove and report
  illicit content. ANPD guidance was still being issued.
- Marco Civil art. 15's six-month access-log retention binds providers
  organized as a legal entity acting professionally for economic purposes —
  **not** this operator. Art. 15 §1 lets a court order any other provider to
  keep access logs "relativos a fatos específicos em período determinado".
- Other jurisdictions (e.g. the EU DSA's notice-and-action and statement of
  reasons for hosting services) may reach Padline through its users; a
  notice-and-action design with recorded decisions is the common denominator.
  Cloudflare's abuse process can also forward complaints to the operator.

**What the code could not do.** Reports arrive only by email, and the only
trace of enforcement is a `blocked` record with an optional reason inside each
room — nothing to list, count, export, or show as diligence. `purge` destroys
exactly the content an authority would ask for, although the Content Policy
promises that child sexual abuse material is "reported to authorities". The
admin surface is reachable directly, so an action can happen with no record at
all. An email address on a policy page is a weak notice channel.

## Decision

**Moderation stays reactive and becomes notice-and-action.** Padline does not
monitor or scan pads and does not keep a list of them. Liability in every
regime above turns on what the operator did *after* learning of content, not on
reading everything; a registry would add a sensitive dataset of every URL —
including PIN-protected pads — without reducing that exposure. What is built is
a notice channel, a case record, evidence capture, and a complete set of
actions.

**A moderation ledger.** One new SQLite-backed Durable Object class,
`ModerationLedger`, addressed by a single fixed name, holds reports, cases, the
action log, and evidence. It is a Durable Object rather than D1, KV, or an
external tracker so the stack stays one Worker and one deploy (ADR-0003,
ADR-0011) and evidence never leaves Cloudflare.

**The room stays authoritative; the ledger records.** A block or freeze lives
in the room's own storage exactly as ADR-0010 decided — enforcement never
depends on the ledger being reachable or consistent. The ledger orchestrates:
it writes the intended action, calls the room through its Durable Object stub,
then writes the outcome. A failure between the two leaves a visible `pending`
action to reconcile against the room, never a silent one.

**No enforcement without a record.** The Worker refuses `op=admin-*` on the
public `/parties/pad-room/:slug` route, so room admin operations are reachable
only from the ledger. `scripts/admin.mjs` talks to `/api/admin/*`, which the
Worker forwards to the ledger. Every enforcement action names a case and a
reason; every content view is logged as a review. The action log is append-only
and hash-chained (each row carries the SHA-256 of the previous one), so a
rewritten history is detectable in an export.

**Admin authentication is unchanged in kind.** The same `ADMIN_SECRET` bearer
token, compared in constant time inside a Durable Object, with the same
concealment: a missing or wrong secret — or none deployed — answers exactly
like an unknown operation (404). The comparison moves to a module both the room
and the ledger use; this amends ADR-0016's placement of the admin secret, not
its access-credential boundary.

**A public report channel.** A `/report` page, and a "Report this pad" entry in
the pad menu and on the removed and PIN screens, post to `/api/reports`. Turnstile
is verified server-side before anything is stored. Any valid slug is accepted —
reporting reveals nothing about whether a pad exists. No IP address is stored;
reporter contact is optional. Reports on a slug with an open case attach to that
case. Email, Cloudflare-forwarded, and authority notices are entered through the
CLI into the same ledger, so every notice has one timeline. The operator is
notified of each new report by email, with grave categories marked.

**Two priorities.** Reports in the grave categories above are `grave`; the rest
are `standard`. Listings sort grave first, then oldest. The operator's working
targets are first review within 24 hours for grave cases and 72 hours for
standard ones — targets recorded here so time-to-review can be measured against
them, not guarantees published to users.

**Evidence before destruction.** Reviewing a violation case can capture
evidence: the full persisted Yjs state, its text rendering, and room metadata,
stored chunked in the ledger (Durable Object SQLite caps a BLOB at 2 MB, the
same as the document cap) with its SHA-256. `remove` is the takedown combination —
capture, then purge, then block — and it refuses to run without evidence on a
violation case. A `removal-request` case (someone asking for their own content to
go) purges without capture, because keeping it would defeat the request.
Evidence is deleted automatically 180 days after its case closes unless placed
on hold; the deletion is itself a logged action.

**The action set.** Review, capture evidence, freeze and unfreeze read-only,
disconnect live connections, block and unblock, purge, remove, dismiss, and
close — each also available in bulk over a file of slugs, dry-run by default.

**Statement of reasons.** A block records its category, and the removed notice a
visitor sees states that category and the date. The operator's free-text reason
and anything about the reporter stay private. An appeal submitted through the
report channel reopens the case.

**Totals and export.** The ledger answers counts by category, source, status, and
action, and time-to-first-review and time-to-action against the targets, and
exports reports, cases, and actions as CSV or JSON. That is both the operator's
overview and the raw material for a transparency report.

**Jurisdiction is configuration, not code.** Padline is open source and will be
forked by operators under other laws. The mechanism above is shared; the values
that encode one jurisdiction's rules are not. They live in one moderation
profile module shared by the Worker and the client: the jurisdiction and review
date, the operator's contact, which report categories are grave, the review
targets, and the evidence and reporter-contact retention periods. The repository
ships exactly one profile — Brazil, for `padline.page` — labelled as such.
Category identifiers are stable across profiles, so the ledger's stored rows keep
their meaning when a fork changes severities. Policy wording and authority
referral channels stay prose (policy pages, runbook) because they cannot be
reduced to values. `docs/operating-a-public-instance.md` tells a fork's operator
what is Brazil-specific and what to redo.

**Phasing.** Phase 1 is everything above, CLI-first. Later phases, each needing
its own decision: aggregate usage metrics through Workers Analytics Engine and a
threshold-triggered list of pads showing mass-circulation or abuse signals;
prospective, per-pad, time-bounded access recording enabled only to comply with
an art. 15 §1 order; and a web console behind Cloudflare Access.

## Consequences

- **A new sensitive dataset, deliberately bounded.** The ledger holds the slugs
  and content of *reported* pads, and reporter contact details when given — not
  every pad. Retention and deletion are part of the design, and the Privacy
  Policy, Terms, and Content Policy change in the same release to say so.
- **`ADMIN_SECRET` now protects more.** Leaking it exposes reported content and
  reporter contacts, not only the ability to block. The operator runbook
  includes rotating it.
- **Holding evidence carries its own risk.** Keeping sexual-exploitation
  material, even to hand to authorities, may be legally sensitive for an
  individual. The runbook defaults grave cases to prompt referral and minimal,
  held retention, and this is the first question to put to counsel.
- **Breaking CLI change.** `admin.mjs <host> <slug> <action>` gives way to
  case-addressed commands, and a direct `op=admin-*` request to `/parties`
  returns 404. `scripts/api-smoke.mjs` and the Workers-runtime suite move to the
  ledger path.
- **CSP relaxes by one origin.** `script-src` and `frame-src` gain
  `https://challenges.cloudflare.com` for Turnstile — the only loosening, and the
  reason Turnstile's pages are the report surfaces and nothing else.
- **A Durable Object migration** (`v2`, a new SQLite class), and two new
  secrets or bindings: the Turnstile secret and the operator notification email.
  Turnstile and the ledger's storage fit the free tier; email availability on the
  account's plan is verified during implementation.
- **ADR-0007 is narrowed, not reversed.** Hosted images still ship only with the
  full abuse bundle; its report flow and Turnstile now exist first, for text.
- **Forks inherit the mechanism, not the compliance.** A fork that deploys
  unchanged runs Brazil's profile and `padline.page`'s policy pages under its own
  domain. The repository can make that visible — the profile's label, the
  operator guide, the README — but cannot prevent it.
- **Response depends on one person.** The targets assume the operator reads
  notifications; there is no delegate. Recorded so it is a known limit, not a
  surprise.

## Rejected

- **A pad registry or admin dashboard over every pad.** Reconsidered with the
  liability question in view and rejected again: it does not reduce
  notice-based exposure, it breaks the Privacy Policy's premise and the PIN's
  promise, and pads created before it existed would be invisible anyway.
- **Proactive scanning or keyword filters.** No regime above imposes general
  monitoring on this kind of service; text filters are noisy, and reading
  everything manufactures the knowledge that liability attaches to without the
  capacity to act on it.
- **Email as the system of record.** It is the channel ADR-0010 relied on, and
  it proves nothing about diligence or timing.
- **The ledger as enforcement source of truth.** Rejected for ADR-0010's reason:
  a second authority for "is this pad blocked" is a consistency problem, and the
  room is already addressed by slug.
- **An external tracker (GitHub Issues, Notion) for cases.** It would copy
  reported content and reporter details to a third party.
- **Storing reporter IPs or fingerprints.** Turnstile plus a Cloudflare rate
  rule bounds abuse of the form without collecting identity.
- **Automatic acknowledgement emails to reporters.** It turns the report form
  into a way to make Padline send email to arbitrary addresses.
- **Capturing evidence on every purge.** It would defeat removal requests, which
  are a privacy right, not an enforcement action.
- **Hard-coding Brazil's values in the ledger and UI.** Every fork would have to
  find and change them across modules, and nothing would mark them as one
  country's choices.
- **Shipping ready-made profiles for other jurisdictions** (EU, US, …). A
  profile nobody has assessed reads as a compliance claim; forks write their own.
- **Selecting a profile by environment variable.** It makes compliance look
  like a switch, while the policy pages and runbook that must change with it
  cannot follow the variable.
- **A web console in phase 1.** A browser holding the bearer secret is a weaker
  posture than the CLI; a console waits for Cloudflare Access.

## Related

ADR-0003 (one Worker, Durable Objects), ADR-0005 (PIN gates everything),
ADR-0007 (images wait for the abuse kit), ADR-0008 (abuse invariants only in
v1), ADR-0009 (hardening, CSP), ADR-0010 (takedown ops — partially superseded),
ADR-0011 (Cloudflare-native tests), ADR-0015 and ADR-0016 (capability and
security modules, admin secret placement).
