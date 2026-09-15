# User guide

Everything you can do with a pad, and what to expect when you hit a limit.

- [Open a pad](#open-a-pad)
- [Write together](#write-together)
- [Share a pad](#share-a-pad)
- [Protect a pad with a PIN](#protect-a-pad-with-a-pin)
- [Share a read-only link](#share-a-read-only-link)
- [Go back in time with history](#go-back-in-time-with-history)
- [Take your content with you](#take-your-content-with-you)
- [Working offline](#working-offline)
- [The status line](#the-status-line)
- [Limits you might hit](#limits-you-might-hit)
- [Report a pad, remove your content, or appeal](#report-a-pad-remove-your-content-or-appeal)
- [When a pad is paused or removed](#when-a-pad-is-paused-or-removed)
- [Privacy in one minute](#privacy-in-one-minute)
- [FAQ](#faq)

## Open a pad

A pad's address **is** the pad. There is no sign-up and no "create" step.

- **New pad** on the home page gives you a random, readable address such as
  `padline.page/mellow-otter-4821`.
- **Open a specific path** — type any name, like `team-standup`, and you land on
  `padline.page/team-standup`. If nobody has written there yet, it's an empty pad
  waiting for you.
- Or just type the URL in your browser.

Addresses use lowercase letters, numbers, and hyphens, 1–64 characters, and
can't start or end with a hyphen. The home page tidies what you type (spaces
become hyphens, capitals become lowercase). A few words are reserved for the
site itself: `api`, `assets`, `parties`, `p`, `r`, `admin`, `terms`, `privacy`,
`content-policy`, `legal`, `about`, `report`.

Opening an address costs nothing: a pad isn't stored until someone types in it.

> **Anyone who knows or guesses an address can open that pad.** Random addresses
> are hard to guess, but they are not secret. Use a [PIN](#protect-a-pad-with-a-pin)
> for anything private, and don't use Padline for passwords or secrets.

## Write together

Share the address and everyone who opens it edits the same page live.

- **Rich blocks** — headings, lists, checklists, quotes, code, and more, using
  the `/` menu. Images and file attachments aren't supported yet.
- **Live cursors and selections** show where others are working.
- **Presence** — the avatars in the header are the people in the pad right now.
- **Your name and color** are generated for you (like "Amber Fox") and stay in
  your browser. Click your own avatar to rename yourself. It's not an account —
  just a label for the people you're writing with.
- **Simultaneous edits merge** without conflicts, even when two people type in
  the same paragraph.
- **Light or dark** — the moon/sun button switches the theme for the whole site.

## Share a pad

Click **Share this pad** (the share icon in the header). The dialog shows:

- **Link** — the pad's address. Anyone with it can edit (after the PIN, if set).
- **Read-only link** — see [below](#share-a-read-only-link).
- **PIN protection** — see [below](#protect-a-pad-with-a-pin).

## Protect a pad with a PIN

A PIN gates **everything** — reading and editing. It's checked by the server
before any of the pad's content is sent, so it can't be bypassed from the browser.

1. Open **Share this pad**.
2. Under **PIN protection**, enter a PIN of 4 to 64 characters and press **Set**.

What to know:

- **Anyone can set a PIN on an unprotected pad.** Whoever sets it first controls
  it. If a pad matters to you, protect it early.
- **Setting or changing a PIN signs everyone else out.** They'll need the new PIN.
  You stay signed in.
- **Your browser remembers the PIN session for 30 days** on that device, so you
  won't be asked again each visit.
- **Wrong guesses slow down.** After 5 wrong PINs, each further attempt waits —
  1 second, then 2, 4, and so on, up to a minute. A correct PIN resets the count.
- **There is no PIN recovery.** No account means nobody — not even the operator —
  can tell you a lost PIN.
- **Remove** the PIN from the same dialog. That also signs everyone out and makes
  the pad open again.

## Share a read-only link

A read-only link lets people read a pad, live, without being able to change it.
The server enforces it — the editor isn't just hidden.

1. Open **Share this pad** and press **Create read-only link**.
2. Copy the link (it ends in `?v=…`) and share it.

A read-only link works even on a PIN-protected pad, without the PIN — it *is* the
permission. To take it back, press **Reset link**: copies you shared stop working
the next time they connect. People already reading keep their current view until
they reload.

Read-only visitors see a **View only** badge and no share or history buttons.

## Go back in time with history

Padline takes **snapshots** automatically while a pad is being edited — at most
one a minute — and keeps the newest 100.

1. Click **Document history** (the clock icon).
2. Pick a snapshot and press **Restore**, then **Confirm restore**.

Restoring doesn't erase anything: it applies the snapshot as a **new edit**, so
you can undo it like any other change. A snapshot shows up about a minute after
edits.

## Take your content with you

Open the **Pad menu** (`…`):

- **Copy as Markdown** puts the whole pad on your clipboard.
- **Download .md** saves it as `<pad-name>.md`.

Markdown can't represent every rich block perfectly, so some formatting may be
simplified. Export anything you care about — Padline gives no uptime or
durability guarantee.

## Working offline

Every pad you visit is cached in your browser. If your connection drops, keep
writing: your changes are saved locally and merge automatically when you're back.
Pads you've opened before also appear instantly on your next visit, before the
server answers.

The site itself needs a connection to load — it isn't an installable offline app.

## The status line

The bar at the bottom of a pad shows:

- **Sync status** — **Synced**, **Connecting**, or **Offline**.
- **Words**, **characters**, **blocks**, and **reading time** (on wider screens).
- When you select text, how many words of the total are selected.

Turn it on or off from the **Pad menu** → **Show status line**. The choice is
remembered in your browser for every pad. With it off, a small colored dot in the
header still shows the sync status.

## Limits you might hit

These keep one pad from harming the service for everyone.

| Limit | What happens |
| --- | --- |
| **Pad size — about 2 MB** of document data | The pad stops accepting edits for everyone. Restore an earlier, smaller snapshot from **History** to bring it back. |
| **50 people connected** to one pad | The next connection is refused ("pad full") until someone leaves. |
| **8 connections per network** to one pad | Further tabs from the same network are refused. |
| **One change larger than 256 KB** | That connection is closed. This is very hard to hit by typing; it's aimed at abuse. |
| **Wrong PINs** | See [PIN backoff](#protect-a-pad-with-a-pin). |

## Report a pad, remove your content, or appeal

Use the report form at **`/report`**. You can reach it from:

- a pad's **Pad menu** → **Report this pad**,
- the **This pad is protected** screen → **Report this pad**,
- a removed pad → **Appeal this removal**,
- the **Content Policy** page.

The form offers three choices:

| Choose | When |
| --- | --- |
| **Report a pad** | It breaks the Content Policy or the law. Pick what's wrong. |
| **Remove my own content** | You wrote it and want it gone. |
| **Appeal a removal** | A pad was removed and you think that was wrong. |

Add the pad's address (the form accepts a full link), optional details, and —
only if you'd like a reply — your email. A quick human check (Cloudflare
Turnstile) runs before you can send.

After sending you get a **reference** code. Mention it if you write to the
operator about the report. You'll get the same confirmation whether or not the
pad exists — reporting never reveals anything about a pad.

## When a pad is paused or removed

- **Editing paused** — an operator has frozen the pad while they look into a
  report. You can still read it, but not edit it, change its PIN, or restore
  history. The badge disappears once the review is over (reload the page).
- **This pad was removed** — the pad broke the Content Policy or the law. The page
  shows the date and the reason category (for example, "Reason: Phishing or
  malware"). Its address can't be reused. If you think it's a mistake, use
  **Appeal this removal**.

## Privacy in one minute

- **No accounts, no tracking scripts, no cookies.**
- **Your pad content** is stored on Cloudflare so it can sync, with automatic
  snapshots.
- **PINs** are stored only as salted hashes; nobody can read them back.
- **Your name, color, theme, status-line choice, PIN sessions, and cached pads**
  live in your browser. Clearing site data removes them.
- **Reports** are kept by the operator to handle them; your email, if you gave
  one, is deleted a set time after the report is closed (the form tells you how
  long). Content from reported pads may be kept as evidence for a limited time.
- **Pads aren't indexed** by search engines.

The instance's own [Privacy Policy](https://padline.page/privacy) is the
authoritative version.

## FAQ

**Someone set a PIN on my pad. Can I get it back?**
Not without the PIN. That's the cost of having no accounts. If it's abuse, report
the pad.

**I lost my PIN.** There's no recovery. If you still have a browser that's signed
in (within 30 days), export the content from there.

**Can I delete a pad?** Clear its content and it's effectively empty, but history
snapshots remain. To have it wiped completely, use **Remove my own content** on
the report form.

**Why can't I open `padline.page/report` (or `/terms`, …) as a pad?** Those
addresses are reserved for the site's own pages.

**Is my pad private if I don't share the link?** Only as private as its address
is unguessable. Use a PIN for real protection.
