import { $ } from "./dom";
import { applyI18n } from "./i18n";

/** `/about`: what Padline is and what it is not. Static text, no data. */
export function mountAbout(app: HTMLElement, home: () => void): () => void {
  app.innerHTML = `
    <section class="screen">
      <div class="stage">
        <div><button class="wordmark linklike" type="button" id="aHome">padline<span class="caret" aria-hidden="true"></span></button></div>
        <article class="notice form about">
          <h1 data-i18n="ab.title"></h1>
          <p data-i18n="ab.p1"></p>
          <p data-i18n="ab.p2"></p>
          <p data-i18n="ab.p3"></p>
          <p data-i18n="ab.p4"></p>
          <div class="acts">
            <button class="btn primary" type="button" id="aBack" data-i18n="e.home"></button>
            <a class="btn line" href="https://github.com/idcesares/padline" target="_blank" rel="noopener noreferrer" data-i18n="ab.src"></a>
          </div>
        </article>
      </div>
    </section>`;
  applyI18n(app);
  $("#aHome", app).addEventListener("click", home);
  $("#aBack", app).addEventListener("click", home);
  return () => {};
}
