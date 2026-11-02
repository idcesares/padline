import { defaultKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { yCollab } from "y-codemirror.next";
import { IndexeddbPersistence } from "y-indexeddb";
import YProvider from "y-partyserver/provider";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { CLOSE, MAX_DOC_BYTES, MSG_PAD_FULL, MSG_PAD_OK, TEXT_KEY } from "../shared/limits";
import { $, copyText, esc, icon, makeToast } from "./dom";
import { applyI18n, formatDate, LANG_NAMES, t } from "./i18n";
import { renderNotice } from "./notice";
import { renderPreview } from "./preview";
import {
  getIdentity,
  getLang,
  getTheme,
  isLang,
  LANGS,
  PALETTE,
  setLang,
  setTheme,
  touchRecent,
  type Theme,
} from "./prefs";

export type EditorNav = {
  /** Go to the landing page. */
  home: () => void;
  /** Mount this pad again from scratch (used by "Try again"). */
  reload: () => void;
  /** Open the report form for this pad. */
  report: () => void;
};

type Status = "connecting" | "saved" | "saving" | "offline" | "reconnecting";

const highlight = HighlightStyle.define([
  { tag: tags.heading1, class: "tok-h1" },
  { tag: tags.heading2, class: "tok-h2" },
  { tag: tags.strong, class: "tok-strong" },
  { tag: tags.emphasis, class: "tok-em" },
  { tag: tags.monospace, class: "tok-code" },
  { tag: tags.link, class: "tok-link" },
  { tag: tags.url, class: "tok-url" },
  { tag: tags.quote, class: "tok-quote" },
  // last, so marker characters override the weight of the text they wrap
  { tag: tags.processingInstruction, class: "tok-mark" },
]);

const HEX = /^#[0-9a-f]{6}$/i;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function mountEditor(app: HTMLElement, slug: string, nav: EditorNav): () => void {
  const url = `${location.origin}/${slug}`;
  const me = getIdentity();

  app.innerHTML = `
    <section class="screen ed" id="edScreen">
      <header class="bar" id="bar">
        <button class="logo" type="button" id="homeBtn" data-i18n-aria="e.home">p<span class="caret" aria-hidden="true"></span></button>
        <button class="slug" type="button" id="slugBtn" data-i18n-aria="e.copyLink"><span class="pre">padline.page/</span><b>${esc(slug)}</b>${icon("copy")}</button>
        <span class="grow"></span>
        <div class="avatars" id="avatars" role="img"></div>
        <span class="status" id="status" data-s="connecting" role="status"><i></i><span id="statusText"></span></span>
        <button class="btn ghost" type="button" id="pvBtn" aria-pressed="false"><span class="i-view">${icon("eye")}</span><span class="i-back">${icon("edit")}</span><span class="lbl" data-i18n="e.preview"></span></button>
        <button class="btn primary" type="button" id="shBtn">${icon("share")}<span class="lbl" data-i18n="e.share"></span></button>
        <button class="icon" type="button" id="moreBtn" aria-haspopup="true" aria-expanded="false" data-i18n-aria="e.more">${icon("more")}</button>
      </header>
      <div class="banners" id="banners" hidden></div>
      <div class="panes" id="panes">
        <div class="pane" id="pane">
          <div class="cmhost" id="cmhost"></div>
          <div class="meta" id="meta"></div>
        </div>
        <div class="prev-pane" id="prevPane" hidden><article class="md" id="md" aria-live="off"></article></div>
      </div>
      <div class="scrim" id="scrim" hidden></div>
      <div class="menu" id="menu" role="menu" hidden>
        <button class="it" type="button" role="menuitem" data-act="md">${icon("down")}<span data-i18n="m.md"></span></button>
        <button class="it" type="button" role="menuitem" data-act="txt">${icon("down")}<span data-i18n="m.txt"></span></button>
        <button class="it" type="button" role="menuitem" data-act="report">${icon("flag")}<span data-i18n="m.report"></span></button>
        <hr>
        <div class="row"><span data-i18n="m.theme"></span><div class="seg" id="thSeg"><button type="button" data-th="system" data-i18n="th.system"></button><button type="button" data-th="light" data-i18n="th.light"></button><button type="button" data-th="dark" data-i18n="th.dark"></button></div></div>
        <div class="row"><span data-i18n="m.lang"></span><select class="lgsel" id="lgSel" data-i18n-aria="m.lang">${LANGS.map((l) => `<option value="${l}" lang="${l}">${LANG_NAMES[l]}</option>`).join("")}</select></div>
      </div>
      <div class="dialog" id="dialog" role="dialog" aria-modal="true" aria-labelledby="shT" hidden>
        <button class="icon x" type="button" id="dlgClose" data-i18n-aria="sh.done">${icon("close")}</button>
        <h2 id="shT" data-i18n="sh.title"></h2>
        <p class="sub" data-i18n="sh.sub"></p>
        <div class="urlrow"><input id="shUrl" type="text" readonly value="${esc(url)}" data-i18n-aria="sh.title"><button class="btn primary" type="button" id="shCopy">${icon("copy")}<span id="shCopyT"></span></button></div>
        <div class="qr"><div class="tile" id="qrTile"></div><p data-i18n="sh.scan"></p></div>
      </div>
      <div class="toast" id="toast" role="status" hidden></div>
    </section>`;

  const screen = $("#edScreen", app);
  const bar = $("#bar", app);
  const banners = $("#banners", app);
  const prevPane = $("#prevPane", app);
  const mdEl = $("#md", app);
  const pvBtn = $<HTMLButtonElement>("#pvBtn", app);
  const cmhost = $("#cmhost", app);
  const meta = $("#meta", app);
  const statusEl = $("#status", app);
  const statusText = $("#statusText", app);
  const avatarsEl = $("#avatars", app);
  const scrim = $("#scrim", app);
  const menu = $("#menu", app);
  const dialog = $("#dialog", app);
  const moreBtn = $<HTMLButtonElement>("#moreBtn", app);
  const shBtn = $<HTMLButtonElement>("#shBtn", app);
  const shCopyT = $("#shCopyT", app);
  const toast = makeToast($("#toast", app));

  // ---------- document, persistence, sync ----------

  const doc = new Y.Doc();
  const ytext = doc.getText(TEXT_KEY);
  const awareness = new Awareness(doc);
  awareness.setLocalStateField("user", { name: me.name, color: me.color, colorLight: `${me.color}33` });

  const idb = new IndexeddbPersistence(`padline:${slug}`, doc);
  const provider = new YProvider(location.host, slug, doc, {
    party: "pad-room",
    awareness,
    protocol: location.protocol === "https:" ? "wss" : "ws",
  });

  // ---------- state ----------

  let disposed = false;
  let wsStatus: "connecting" | "connected" | "disconnected" = "connecting";
  let everConnected = false;
  let synced = false;
  let saving = false;
  let savingTimer: ReturnType<typeof setTimeout> | undefined;
  let metaTimer: ReturnType<typeof setTimeout> | undefined;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewOn = false;
  let full = false;
  let recorded = false;
  let lastOpener: HTMLElement | null = null;

  function record() {
    if (recorded) return;
    recorded = true;
    touchRecent(slug);
  }

  // ---------- status pill and banners ----------

  function currentStatus(): Status {
    if (!navigator.onLine) return "offline";
    if (wsStatus === "connected" && synced) return saving ? "saving" : "saved";
    return everConnected ? "reconnecting" : "connecting";
  }

  function renderStatus() {
    const s = currentStatus();
    statusEl.dataset.s = s;
    statusText.textContent = t(`s.${s}`);
    const showOffline = s === "offline";
    const parts: string[] = [];
    if (showOffline) {
      parts.push(
        `<div class="banner warn">${icon("alert")}<div><b>${esc(t("st.offline.t"))}</b>${esc(t("st.offline.b"))}</div></div>`,
      );
    }
    if (full) {
      parts.push(
        `<div class="banner bad">${icon("alert")}<div><b>${esc(t("st.full.t"))}</b>${esc(t("st.full.b"))}</div></div>`,
      );
    }
    banners.innerHTML = parts.join("");
    banners.hidden = parts.length === 0;
  }

  function markSaving() {
    saving = true;
    renderStatus();
    clearTimeout(savingTimer);
    savingTimer = setTimeout(() => {
      saving = false;
      renderStatus();
    }, 700);
  }

  // ---------- meta line ----------

  function renderMeta() {
    const text = ytext.toString();
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const kb = new TextEncoder().encode(text).length / 1024;
    meta.textContent = `${words} ${t("e.words")} · ${kb.toFixed(1)} KB / ${MAX_DOC_BYTES / 1024 / 1024} MB`;
  }

  function scheduleMeta() {
    clearTimeout(metaTimer);
    metaTimer = setTimeout(renderMeta, 150);
  }

  // ---------- preview ----------

  function renderPreviewNow() {
    clearTimeout(previewTimer);
    renderPreview(mdEl, ytext.toString());
  }

  function schedulePreview() {
    if (!previewOn) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreviewNow, 250);
  }

  function renderPreviewButton() {
    pvBtn.setAttribute("aria-pressed", String(previewOn));
    // Fixed name: aria-pressed carries the state, and the label span is hidden when narrow.
    pvBtn.setAttribute("aria-label", t("e.preview"));
  }

  function setPreview(on: boolean) {
    previewOn = on;
    screen.dataset.preview = on ? "on" : "off";
    prevPane.hidden = !on;
    if (on) renderPreviewNow();
    else view.focus();
    renderPreviewButton();
  }

  pvBtn.addEventListener("click", () => setPreview(!previewOn));

  // ---------- presence ----------

  const MAX_AVATARS = 5;

  function renderAvatars() {
    const others: { name: string; color: string }[] = [];
    awareness.getStates().forEach((state, id) => {
      if (id === doc.clientID) return;
      const u = state.user as { name?: unknown; color?: unknown } | undefined;
      if (!u || typeof u.name !== "string") return;
      const color = typeof u.color === "string" && HEX.test(u.color) ? u.color : PALETTE[0];
      others.push({ name: u.name.slice(0, 40), color });
    });
    const all = [{ name: t("e.you"), color: me.color, self: true }, ...others.map((o) => ({ ...o, self: false }))];
    const shown = all.slice(0, MAX_AVATARS);
    const more = all.length - shown.length;
    avatarsEl.setAttribute("aria-label", `${all.length} · ${t("e.here")}`);
    avatarsEl.innerHTML =
      shown
        .map(
          (a) =>
            `<span class="av" style="--c:${a.color}" title="${esc(a.name)}">${esc(a.self ? initials(me.name) : initials(a.name))}</span>`,
        )
        .join("") + (more > 0 ? `<span class="av" style="--c:${PALETTE[4]}">+${more}</span>` : "");
  }

  // ---------- editor ----------

  const placeholderSlot = new Compartment();
  const view = new EditorView({
    parent: cmhost,
    state: EditorState.create({
      doc: ytext.toString(),
      extensions: [
        keymap.of(defaultKeymap),
        drawSelection(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(highlight),
        placeholderSlot.of(placeholder(t("e.ph"))),
        yCollab(ytext, awareness),
        EditorView.contentAttributes.of({
          "aria-label": t("e.pad"),
          spellcheck: "false",
          autocapitalize: "off",
        }),
      ],
    }),
  });

  // ---------- provider and document events ----------

  doc.on("update", (_update: Uint8Array, origin: unknown) => {
    schedulePreview();
    if (origin === provider || origin === idb) {
      scheduleMeta();
      return;
    }
    record();
    markSaving();
    scheduleMeta();
  });

  idb.on("synced", () => {
    if (disposed) return;
    if (ytext.length > 0) record();
    renderMeta();
  });

  provider.on("status", ({ status }: { status: "connected" | "disconnected" | "connecting" }) => {
    wsStatus = status;
    if (status === "connected") everConnected = true;
    renderStatus();
  });

  provider.on("sync", (isSynced: boolean) => {
    synced = isSynced;
    if (isSynced) record();
    renderStatus();
  });

  provider.on("custom-message", (message: string) => {
    if (message === MSG_PAD_FULL) full = true;
    else if (message === MSG_PAD_OK) full = false;
    else return;
    renderStatus();
  });

  provider.on("connection-close", (event: CloseEvent) => {
    if (disposed) return;
    if (event.code === CLOSE.removed) void showRemoved();
    else if (event.code === CLOSE.busy) showBusy();
    else if (event.code === CLOSE.invalidSlug) showInvalid();
  });

  awareness.on("change", renderAvatars);

  // ---------- closed pads ----------

  function leave(): void {
    dispose();
  }

  async function showRemoved() {
    // A removed pad must not keep a readable copy on this device. A copy on
    // another offline device is out of reach; the block itself is the remedy.
    try {
      await idb.clearData();
    } catch {
      /* the notice matters more than the cleanup */
    }
    leave();
    let body = t("st.removed.b");
    try {
      const res = await fetch(`/parties/pad-room/${encodeURIComponent(slug)}?op=status`);
      const data = (await res.json()) as { removed?: { at: number; category: string } | null };
      if (data.removed) {
        const known = ["spam", "scam", "illegal", "harassment", "personal", "other"];
        const cat = known.includes(data.removed.category) ? data.removed.category : "other";
        body = t("st.removed.cat", { cat: t(`cat.${cat}`), date: formatDate(data.removed.at) });
      }
    } catch {
      /* keep the generic text */
    }
    renderNotice(app, {
      title: t("st.removed.t"),
      slugline: `padline.page/${slug}`,
      body,
      actions: [{ label: t("e.home"), run: nav.home }],
    });
  }

  function showBusy() {
    leave();
    renderNotice(app, {
      title: t("st.busy.t"),
      slugline: `padline.page/${slug}`,
      body: t("st.busy.b"),
      actions: [
        { label: t("st.retry"), primary: true, run: nav.reload },
        { label: t("e.home"), run: nav.home },
      ],
    });
  }

  function showInvalid() {
    leave();
    renderNotice(app, {
      title: t("st.invalid.t"),
      body: t("l.err.invalid"),
      actions: [{ label: t("e.home"), primary: true, run: nav.home }],
    });
  }

  // ---------- menu ----------

  function setMenu(open: boolean) {
    menu.hidden = !open;
    moreBtn.setAttribute("aria-expanded", String(open));
  }

  function syncMenuState() {
    const theme = getTheme();
    menu.querySelectorAll<HTMLElement>("[data-th]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.th === theme));
    });
    menu.querySelector<HTMLSelectElement>("#lgSel")!.value = getLang();
  }

  function download(ext: "md" | "txt") {
    const blob = new Blob([ytext.toString()], {
      type: ext === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${slug}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    toast(t("toast.dl"));
  }

  function renderText() {
    applyI18n(app);
    shCopyT.textContent = t("sh.copy");
    renderStatus();
    renderMeta();
    renderAvatars();
    syncMenuState();
    renderPreviewButton();
    app.querySelector("#qrTile svg")?.setAttribute("aria-label", `${t("sh.qr")} ${url}`);
    view.dispatch({ effects: placeholderSlot.reconfigure(placeholder(t("e.ph"))) });
    view.contentDOM.setAttribute("aria-label", t("e.pad"));
  }

  moreBtn.addEventListener("click", () => {
    const open = Boolean(menu.hidden);
    setMenu(open);
    if (open) menu.querySelector<HTMLElement>("[data-act]")?.focus();
  });

  menu.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const act = target.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "md" || act === "txt") {
      setMenu(false);
      download(act);
      return;
    }
    if (act === "report") {
      setMenu(false);
      nav.report();
      return;
    }
    const th = target.closest<HTMLElement>("[data-th]")?.dataset.th;
    if (th) {
      setTheme(th as Theme);
      syncMenuState();
      return;
    }
  });

  menu.querySelector<HTMLSelectElement>("#lgSel")!.addEventListener("change", (e) => {
    const lg = (e.target as HTMLSelectElement).value;
    if (isLang(lg)) {
      setLang(lg);
      renderText();
    }
  });

  const onDocPointerDown = (e: PointerEvent) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && !moreBtn.contains(e.target as Node)) {
      setMenu(false);
    }
  };
  document.addEventListener("pointerdown", onDocPointerDown);

  // ---------- share dialog ----------

  const inertTargets = [bar, banners, $("#panes", app)];

  function openDialog(opener: HTMLElement) {
    lastOpener = opener;
    setMenu(false);
    dialog.hidden = false;
    scrim.hidden = false;
    inertTargets.forEach((el) => el.setAttribute("inert", ""));
    const input = $<HTMLInputElement>("#shUrl", app);
    input.focus();
    input.select();
    void drawQr();
  }

  // Loaded on first use so the editor chunk does not carry the encoder.
  let qrFor = "";
  async function drawQr() {
    if (qrFor === url) return;
    try {
      const { renderQr } = await import("./qr");
      if (disposed) return;
      renderQr($("#qrTile", app), url, `${t("sh.qr")} ${url}`);
      qrFor = url;
    } catch {
      // The link and the copy button still work without it.
    }
  }

  function closeDialog() {
    if (dialog.hidden) return;
    dialog.hidden = true;
    scrim.hidden = true;
    inertTargets.forEach((el) => el.removeAttribute("inert"));
    (lastOpener ?? shBtn).focus();
  }

  shBtn.addEventListener("click", () => openDialog(shBtn));
  scrim.addEventListener("click", closeDialog);
  $("#dlgClose", app).addEventListener("click", closeDialog);

  async function copyLink(): Promise<boolean> {
    const ok = await copyText(url);
    if (!ok) $<HTMLInputElement>("#shUrl", app).select();
    return ok;
  }

  $("#shCopy", app).addEventListener("click", async () => {
    if (await copyLink()) {
      shCopyT.textContent = t("sh.copied");
      setTimeout(() => {
        if (!disposed) shCopyT.textContent = t("sh.copy");
      }, 1600);
    }
  });

  $("#slugBtn", app).addEventListener("click", async () => {
    toast((await copyLink()) ? t("toast.copied") : t("toast.nocopy"));
  });

  $("#homeBtn", app).addEventListener("click", nav.home);

  // ---------- keyboard ----------

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (!dialog.hidden) {
        closeDialog();
      } else if (!menu.hidden) {
        setMenu(false);
        moreBtn.focus();
      }
      return;
    }
    if (e.key === "Tab" && !dialog.hidden) {
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("button, input")).filter(
        (el) => !(el as HTMLButtonElement).disabled,
      );
      const i = focusable.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!e.shiftKey && i === focusable.length - 1) {
        e.preventDefault();
        focusable[0].focus();
      }
    }
  };
  document.addEventListener("keydown", onKeyDown);

  // ---------- typing fade ----------

  const unfade = () => screen.classList.remove("typing");
  cmhost.addEventListener("beforeinput", () => screen.classList.add("typing"));
  screen.addEventListener("pointermove", unfade);
  screen.addEventListener("pointerdown", unfade);
  bar.addEventListener("focusin", unfade);

  // ---------- connectivity ----------

  const onNet = () => renderStatus();
  window.addEventListener("online", onNet);
  window.addEventListener("offline", onNet);

  // ---------- go ----------

  renderText();
  view.focus();

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(savingTimer);
    clearTimeout(metaTimer);
    clearTimeout(previewTimer);
    document.removeEventListener("pointerdown", onDocPointerDown);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("online", onNet);
    window.removeEventListener("offline", onNet);
    // partysocket reconnects on its own, so stop it before anything else.
    provider.disconnect();
    provider.destroy();
    view.destroy();
    void idb.destroy();
    doc.destroy();
  }

  return dispose;
}
