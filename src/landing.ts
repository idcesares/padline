import { checkSlug, normalizeSlug, randomSlug } from "../shared/slug";
import { $, esc, icon } from "./dom";
import { ago, applyI18n, t } from "./i18n";
import { getRecent } from "./prefs";

/** The demo card shows what a live pad looks like; it is static and decorative. */
const DEMO = `
  <div class="l h1"><span class="mk"># </span>Sprint notes</div>
  <div class="l">Demo on <span class="mk">**</span><span class="bold">Thursday</span><span class="mk">**</span>, 14:00<span class="rc" style="--c:var(--p2)"><i>Teal Heron</i></span></div>
  <div class="l li"><span class="mk">- </span>Ship the share sheet</div>
  <div class="l li"><span class="mk">- [x] </span>Fix the <span class="rsel" style="--c:var(--p1)">reconnect</span><span class="rc" style="--c:var(--p1)"><i>Amber Fox</i></span> banner</div>
  <div class="l li"><span class="mk">- </span>Ask for a name for the logo</div>`;

export function mountLanding(app: HTMLElement, go: (slug: string) => void): () => void {
  app.innerHTML = `
    <section class="screen">
      <div class="landing">
        <div><span class="wordmark">padline<span class="caret" aria-hidden="true"></span></span></div>
        <div class="hero">
          <div>
            <h1><span data-i18n="l.h"></span><span class="caret" aria-hidden="true"></span></h1>
            <p class="sub" data-i18n="l.sub"></p>
            <form id="addrForm" autocomplete="off" novalidate>
              <div class="addr">
                <label class="pre" for="slugInput">padline.page/</label>
                <input id="slugInput" type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="80" data-i18n-ph="l.ph" />
                <button class="btn primary" id="openBtn" type="submit" disabled><span data-i18n="l.open"></span>${icon("arrow")}</button>
              </div>
              <p class="help" id="help" role="status" aria-live="polite"></p>
            </form>
            <div class="rand"><span data-i18n="l.random"></span>
              <button class="chip" type="button" id="randGo"><span id="randName"></span>${icon("arrow", 16)}</button>
              <button class="icon" type="button" id="randShuffle" data-i18n-aria="l.shuffle">${icon("shuffle")}</button>
            </div>
            <div class="recent" id="recent" hidden>
              <div class="eyebrow" data-i18n="l.recent"></div>
              <ul id="recentList"></ul>
            </div>
          </div>
          <aside class="demo" aria-hidden="true">
            <div class="dbar"><span>padline.page/sprint-notes</span><span class="avatars"><span class="av" style="--c:var(--p1)">AF</span><span class="av" style="--c:var(--p2)">TH</span><span class="av" style="--c:var(--p3)">VF</span></span></div>
            <div class="dbody">${DEMO}</div>
          </aside>
        </div>
        <div class="foot"><p data-i18n="l.note"></p><nav class="fnav"><button class="linklike" type="button" id="reportLink" data-i18n="l.report"></button><button class="linklike" type="button" id="aboutLink" data-i18n="l.about"></button></nav></div>
      </div>
    </section>`;

  const input = $<HTMLInputElement>("#slugInput", app);
  const help = $("#help", app);
  const openBtn = $<HTMLButtonElement>("#openBtn", app);
  const randName = $("#randName", app);
  const recent = $("#recent", app);
  const recentList = $("#recentList", app);

  function renderRecent() {
    const items = getRecent().slice(0, 5);
    recent.hidden = items.length === 0;
    recentList.innerHTML = items
      .map(
        (r) =>
          `<li><button type="button" data-slug="${esc(r.slug)}"><span class="s">${esc(r.slug)}</span><span class="t">${esc(ago(r.at))}</span>${icon("chev")}</button></li>`,
      )
      .join("");
  }

  function onInput() {
    const raw = input.value;
    const slug = normalizeSlug(raw);
    help.className = "help";
    if (!raw.trim()) {
      help.textContent = "";
      openBtn.disabled = true;
      return;
    }
    const verdict = checkSlug(slug);
    if (verdict === "invalid") {
      help.className = "help err";
      help.textContent = t("l.err.invalid");
      openBtn.disabled = true;
      return;
    }
    if (verdict === "reserved") {
      help.className = "help err";
      help.textContent = t("l.err.reserved");
      openBtn.disabled = true;
      return;
    }
    openBtn.disabled = false;
    if (slug !== raw.trim()) {
      help.innerHTML = `${esc(t("l.opensas"))} <b>padline.page/${esc(slug)}</b>`;
    } else {
      help.textContent = "";
    }
  }

  function fill() {
    applyI18n(app);
    renderRecent();
    onInput();
  }

  randName.textContent = randomSlug();
  fill();

  input.addEventListener("input", onInput);
  $("#addrForm", app).addEventListener("submit", (e) => {
    e.preventDefault();
    const slug = normalizeSlug(input.value);
    if (checkSlug(slug) === "ok") go(slug);
  });
  // "report" is a reserved slug, so this route can never collide with a pad.
  $("#reportLink", app).addEventListener("click", () => go("report"));
  $("#aboutLink", app).addEventListener("click", () => go("about"));
  $("#randGo", app).addEventListener("click", () => go(randName.textContent ?? randomSlug()));
  $("#randShuffle", app).addEventListener("click", () => {
    randName.textContent = randomSlug();
  });
  recentList.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-slug]");
    if (b?.dataset.slug) go(b.dataset.slug);
  });

  // Landing has no language switch of its own; follow the browser, refresh
  // the relative times while the page stays open.
  const tick = setInterval(renderRecent, 60_000);
  input.focus({ preventScroll: true });
  return () => clearInterval(tick);
}
