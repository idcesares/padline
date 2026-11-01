import { CATEGORIES, CONTACT_MAX, NOTE_MAX } from "../shared/moderation";
import { checkSlug, normalizeSlug } from "../shared/slug";
import { $, esc } from "./dom";
import { applyI18n, t } from "./i18n";
import { renderNotice } from "./notice";

/**
 * `/report`: the public form (ADR-0002). The answer is the same whether or not
 * the pad exists, so this page never says which it was. `pad` pre-fills the
 * address when the visitor came from a pad's menu.
 */
export function mountReport(app: HTMLElement, pad: string, home: () => void): () => void {
  app.innerHTML = `
    <section class="screen">
      <div class="stage">
        <div><button class="wordmark linklike" type="button" id="rHome">padline<span class="caret" aria-hidden="true"></span></button></div>
        <form class="notice form" id="rForm" autocomplete="off" novalidate>
          <h1 data-i18n="r.title"></h1>
          <p data-i18n="r.sub"></p>
          <label class="fld"><span data-i18n="r.pad"></span>
            <span class="addr sm"><span class="pre">padline.page/</span><input id="rPad" type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="80" value="${esc(pad)}"></span>
          </label>
          <label class="fld"><span data-i18n="r.cat"></span>
            <select id="rCat">${CATEGORIES.map((c) => `<option value="${c}" data-i18n="cat.${c}"></option>`).join("")}</select>
          </label>
          <label class="fld"><span data-i18n="r.note"></span>
            <textarea id="rNote" rows="3" maxlength="${NOTE_MAX}"></textarea>
            <span class="hint"><span data-i18n="r.note.hint"></span> <span id="rCount"></span></span>
          </label>
          <label class="fld"><span data-i18n="r.contact"></span>
            <input id="rContact" type="email" maxlength="${CONTACT_MAX}" autocapitalize="off" spellcheck="false">
          </label>
          <p class="help err" id="rErr" role="alert"></p>
          <div class="acts">
            <button class="btn primary" type="submit" id="rSend" data-i18n="r.send"></button>
            <button class="btn line" type="button" id="rBack" data-i18n="e.home"></button>
          </div>
        </form>
      </div>
    </section>`;
  applyI18n(app);

  const padInput = $<HTMLInputElement>("#rPad", app);
  const cat = $<HTMLSelectElement>("#rCat", app);
  const note = $<HTMLTextAreaElement>("#rNote", app);
  const contact = $<HTMLInputElement>("#rContact", app);
  const count = $("#rCount", app);
  const err = $("#rErr", app);
  const send = $<HTMLButtonElement>("#rSend", app);

  const renderCount = () => {
    count.textContent = `${note.value.length}/${NOTE_MAX}`;
  };
  renderCount();
  note.addEventListener("input", renderCount);
  $("#rHome", app).addEventListener("click", home);
  $("#rBack", app).addEventListener("click", home);

  $("#rForm", app).addEventListener("submit", async (e) => {
    // The page's CSP has form-action 'none': the report goes out by fetch.
    e.preventDefault();
    err.textContent = "";
    const slug = normalizeSlug(padInput.value);
    if (checkSlug(slug) !== "ok") {
      err.textContent = t("r.err.pad");
      padInput.focus();
      return;
    }
    send.disabled = true;
    send.textContent = t("r.sending");
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug,
          category: cat.value,
          note: note.value,
          contact: contact.value,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      renderNotice(app, {
        title: t("r.done.t"),
        body: t("r.done.b"),
        actions: [{ label: t("e.home"), primary: true, run: home }],
      });
    } catch {
      err.textContent = t("r.err");
      send.disabled = false;
      send.textContent = t("r.send");
    }
  });

  padInput.focus({ preventScroll: true });
  return () => {};
}
