import { $, esc } from "./dom";
import { applyI18n } from "./i18n";

export type NoticeAction = { label: string; primary?: boolean; run: () => void };

/**
 * Full-screen state for a pad that cannot be opened (invalid, reserved, busy,
 * removed, error). Same shell as the landing so the page never looks broken.
 * `title`, `body`, `slugline` and the labels are already translated.
 */
export function renderNotice(
  app: HTMLElement,
  opts: { title: string; body: string; slugline?: string; actions: NoticeAction[] },
): void {
  app.innerHTML = `
    <section class="screen">
      <div class="stage">
        <div><span class="wordmark">padline<span class="caret" aria-hidden="true"></span></span></div>
        <div class="notice">
          <h1>${esc(opts.title)}</h1>
          ${opts.slugline ? `<p class="slugline">${esc(opts.slugline)}</p>` : ""}
          <p>${esc(opts.body)}</p>
          <div class="acts">
            ${opts.actions
              .map(
                (a, i) =>
                  `<button class="btn ${a.primary ? "primary" : "line"}" type="button" data-i="${i}">${esc(a.label)}</button>`,
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>`;
  applyI18n(app);
  $(".acts", app).addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-i]");
    if (b) opts.actions[Number(b.dataset.i)]?.run();
  });
  $<HTMLButtonElement>(".acts button", app).focus({ preventScroll: true });
}
