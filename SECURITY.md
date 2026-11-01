# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through [GitHub Security Advisories](https://github.com/idcesares/padline/security/advisories/new) (preferred) or by email to **contact@padline.page** with `[padline security]` in the subject.

Include what you found, how to reproduce it, and the impact you believe it has. You will get an acknowledgment as soon as possible, and a fix or a clear response before any public disclosure is expected.

This process is for vulnerabilities in the code. A complaint about a specific pad's content (abuse, spam, copyright) is a moderation matter, not a vulnerability; it goes through the instance's report channel.

## Model and scope

Padline is a public notepad ([ADR-0001](docs/adr/0001-a-public-notepad.md)). The following are by design, not vulnerabilities:

- Anyone who knows a pad's address can read and edit it.
- The operator can see every pad.
- Random addresses are hard to guess but are not secrets.

In scope and very welcome:

- Escaping the limits in [ADR-0003](docs/adr/0003-pad-lifecycle-and-limits.md): document size, connection count, message size.
- Reaching a room's `admin-*` operations from a public route ([ADR-0002](docs/adr/0002-lean-moderation.md)).
- Reading or writing a pad that is blocked.
- Cross-site scripting, or anything that defeats the Content Security Policy.
- Learning whether a pad exists through a response that should not reveal it.
