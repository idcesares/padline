# Operating a public instance

Padline is MIT-licensed: anyone can fork it and run their own instance. This
page is for that person. It is not legal advice — for you or for anyone else.

## You are the operator

Whoever deploys an instance and points a domain at it is the one answering for
what it hosts. The license disclaims warranty for the code; it does not move
responsibility for published content back to this repository or its author.

`padline.page` is operated by one individual, in Brazil, with no economic
purpose. Its policies, its moderation design, and the legal reasoning recorded
in this repository were written for **that** operator under **Brazilian law as
understood in September 2026**, without review by counsel. They are a starting
point, not a compliance guarantee — not even for another Brazilian operator
whose situation differs (a company, a commercial service, a larger audience).

## What in this repository is Brazil-specific

- **The legal analysis** in the Context section of
  [ADR-0018](adr/0018-notice-and-action-moderation.md): the STF's 2025–2026
  thesis on Marco Civil art. 19, ECA Digital (Lei 15.211/2025), and the reading
  of Marco Civil art. 15 — including the conclusion that six-month access-log
  retention does not apply, which rests on the operator being an individual
  with no economic purpose.
- **Which report categories are grave**, the **review targets** (24 h grave,
  72 h standard), and the **retention periods** (180 days). These live in the
  moderation profile once the moderation kit ships (see below).
- **Referral channels** for criminal content in the operator runbook.
- **The published Terms, Privacy Policy, and Content Policy**
  (`src/routes/legal.tsx`), including the contact address and what they promise.

## What is designed to travel

The moderation *mechanism* decided in ADR-0018 is deliberately
jurisdiction-neutral: a reachable notice channel, a case per reported pad, a
recorded review and decision, evidence captured before anything destructive, a
statement of reasons shown on removed pads, appeals, and an exportable,
tamper-evident action log. Notice-and-action systems with recorded decisions
are a common shape in many legal regimes, but whether this one satisfies yours —
deadlines, mandatory reporting, log retention, representatives, transparency
reports — is a question for your own jurisdiction.

## Checklist before opening a fork to the public

1. **Assess your own obligations** where you live and where your users are,
   considering whether you act as an individual or an organization and whether
   the service has an economic purpose. Where log retention applies to you
   (in Brazil, for example, art. 15 binds legal entities acting professionally
   for economic purposes), note that Padline does not keep access logs — you
   would need to add that, and disclose it.
2. **Edit the moderation profile**, `src/lib/moderation-profile.ts` —
   jurisdiction, operator contact (the policy pages use it), grave categories,
   review targets, retention periods. Keep existing category ids stable once
   your instance has stored cases.
3. **Rewrite the policy pages** for your instance: your contact, your
   jurisdiction, your retention, your enforcement process. Do not publish
   `padline.page`'s pages under your domain.
4. **Write your runbook's referral channels** for your country's authorities
   and hotlines.
5. **Set the secrets** (`ADMIN_SECRET`; the Turnstile secret once reporting
   ships) and the Cloudflare rate-limiting rules described in the README.
6. **Record your decisions as ADRs in your fork.** Add one that supersedes the
   Context of ADR-0018 with your own assessment, so the next person reading
   your fork knows which law it was built for.

## Status

Today, instances have the moderation profile and the case ledger of
ADR-0018: notices are recorded as cases, and every review and takedown
([ADR-0010](adr/0010-reactive-takedown-admin-ops.md)'s operations) runs through
the ledger and its hash-chained action log. The Turnstile-gated report API
(`POST /api/reports`) files reports as cases; a pad can be frozen or
disconnected; a removed pad shows its category and date; and a pad's content
can be sealed as evidence, kept for the profile's retention period after its
case closes unless held. The CLI runs actions in bulk, totals cases and review
times against the profile's targets, and exports reports, cases, actions, and
evidence records. The report form is decided but not yet implemented.
