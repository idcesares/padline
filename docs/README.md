# Padline documentation

Pick the row that matches what you're trying to do.

| I want to… | Read |
| --- | --- |
| **Use Padline** — write, share, protect, export a pad | [User guide](user-guide.md) |
| **Run my own instance** — local dev, deploy, secrets, upgrades | [Self-hosting](self-hosting.md) |
| **Know what I'm responsible for** running a public instance | [Operating a public instance](operating-a-public-instance.md) |
| **Moderate** — handle reports, take pads down, keep evidence, see totals | [Moderation guide](moderation-guide.md) |
| Look up a **moderation command** | [CLI reference](reference/cli.md) |
| Look up an **endpoint, status code, or WebSocket close code** | [HTTP & WebSocket API](reference/http-api.md) |
| Look up a **secret, binding, profile value, or built-in limit** | [Configuration & limits](reference/configuration.md) |
| **Understand how it's built** — modules, flows, storage | [Architecture](architecture.md) |
| Understand **why** a decision was made | [Architecture decision records](adr/) |
| **Contribute** — setup, verification, PR conventions | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| Report a **security vulnerability** | [SECURITY.md](../SECURITY.md) |
| Work on the code **as an AI agent** | [AGENTS.md](../AGENTS.md) |

## Words used throughout

Padline has a small, precise vocabulary — **pad**, **slug**, **room**,
**snapshot**, **PIN**, **read-only link**, **report**, **case**, **evidence**,
**moderation ledger**, **moderation profile**, **freeze**, **takedown**. They
are defined once, in [CONTEXT.md](../CONTEXT.md), and every page here uses them
the same way.

## How these docs are organized

- **Guides** walk through a job from start to finish: the user guide, self-hosting,
  and the moderation guide.
- **Reference** pages are for looking things up: every command, endpoint, and
  setting, with exact names and values. They say *what*; guides say *when and why*.
- **Explanation** — the architecture page and the ADRs — describes how the
  system fits together and which alternatives were rejected.

If a page and the code disagree, the code is right and the page is a bug —
please open an issue or a PR.
