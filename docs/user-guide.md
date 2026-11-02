# User guide

Padline is a public notepad. Open an address, type, and everyone on that address sees the same text live.

## Public by design

Anyone who knows an address can read and edit that pad, and the person running the site can see every pad. Do not put secrets in a pad. The site says this in one line on the landing page.

## Opening a pad

On the landing page, type an address, or press the random address button for something like `mellow-otter-42`. You can also go straight to `padline.page/any-name`.

An address is made of lowercase letters, digits and hyphens, up to 64 characters. Whatever you type is tidied up, and the page shows it as "Opens as ...":

| You type | It opens as |
| --- | --- |
| `Trip Food` | `trip-food` |
| `Ação_hoje` | `acao-hoje` |

Addresses are flat: `/trip-food` works, `/trip/food` does not. A few words are reserved for the site itself (for example `api`, `admin`, `report`, `about`); typing one shows a notice and lets you choose another.

A pad that nobody has typed in yet is not saved anywhere. It exists from your first keystroke.

## Writing

The editor is plain text with Markdown highlighting. The status pill in the top bar tells you the state: connecting, saving, saved, reconnecting or offline. Below the text, a line shows the word count and the pad's size against its 1 MB limit.

Other people on the pad appear as avatars (yourself first, then up to five, then "+N"), with coloured cursors and selections in the text. Your name and colour are generated for you and kept on your device; they are not an account.

While you type, the top bar fades out of the way. Move the pointer or press into the bar to bring it back.

## Preview

**Preview** in the top bar shows the pad as formatted Markdown beside the text (on a narrow screen it replaces the editor until you choose **Edit**). It covers headings, emphasis, lists, task lists, quotes, code, tables, links and horizontal rules. Single line breaks are kept as line breaks, unlike strict Markdown. Images are not supported, raw HTML is shown as text, and only `http`, `https` and `mailto` links are clickable. Preview is only a view: it never changes the pad.

## Sharing

Select **Share** to copy the link. Clicking the address in the top bar also copies it. Anyone with the link can edit.

## Download

Open the menu and choose **Download .md** or **Download .txt** to save the pad's text.

## Theme and language

The menu switches between light, dark and system themes, and picks the language: English, Português, Español, Français, Deutsch or Italiano. Both are remembered on your device. On a first visit the language follows your browser's preferred languages, falling back to English.

## Working offline

Every pad you open is cached on your device. If you lose the connection, keep typing: a banner says you are offline, and your edits merge when you reconnect.

## Limits

| Limit | Value | What you see |
| --- | --- | --- |
| Pad size | about 1 MB | A "pad is full" banner for everyone; the pad stops saving until you delete text. |
| People on one pad | about 50 | A "this pad is busy" notice with a retry button. |
| Address length | 64 characters | The landing page shows what the address becomes. |

The exact numbers are in [Configuration and limits](reference/configuration.md).

## When a pad is removed

If the site's operator blocks an address, opening it shows a "removed" notice with a category and a date. The pad's text is gone.

## Reporting a pad

Open the menu and choose **Report this pad**, or use **Report a pad** at the bottom of the landing page. Pick a category, add a short note if you like, and optionally an email in case the operator needs to ask something. Do not paste the pad's content into the note. The answer is the same whether or not the address exists, and no IP address is stored.
