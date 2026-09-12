# Triage Labels

The engineering skills speak in terms of five canonical triage roles. This repo
has no GitHub labels to attach them to — issues are local markdown under
`.scratch/`, and triage state is the `Status:` line near the top of each issue
file (see [`issue-tracker.md`](issue-tracker.md)). These are the strings to
write there.

| Canonical role   | `Status:` value   | Meaning                                  |
| ---------------- | ----------------- | ---------------------------------------- |
| `needs-triage`   | `needs-triage`    | Not yet evaluated; scope and value unclear |
| `needs-info`     | `needs-info`      | Blocked on an answer from whoever raised it |
| `ready-for-agent`| `ready-for-agent` | Fully specified; an agent can implement it unattended |
| `ready-for-human`| `ready-for-human` | Needs human judgement, access, or a design call |
| `wontfix`        | `wontfix`         | Decided against; leave the file with the reason |

The default strings are kept verbatim, so a skill that names a role can write it
straight into the file with no translation step.

## Not the same axis as wayfinding

`issue-tracker.md` also describes `Status: claimed` / `Status: resolved` for
wayfinding tickets. That is a lifecycle — who is working on it and whether it is
finished — not a triage verdict. A wayfinding ticket under `.scratch/<effort>/`
uses those values; a triaged issue uses the table above. Don't mix the two in
one file.
