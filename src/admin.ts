import { MAX_DOC_BYTES } from "../shared/limits";
import { ADMIN_FILTERS, ADMIN_LIST_LIMIT, type AdminFilter, CATEGORIES } from "../shared/moderation";
import { $, esc } from "./dom";
import { ago, applyI18n, formatDateTime, t } from "./i18n";

// The operator's page (ADR-0002). Loaded on demand, so visitors never download
// it. Every request goes to /api/admin/*, which the Worker authorizes itself.

type PadRow = {
  slug: string;
  size: number | null;
  created: number | null;
  last_edit: number | null;
  edits: number | null;
  status: string;
  reports: number;
};
type Report = { id: number; category: string; note: string | null; contact: string | null; created: number };
type Detail = {
  pad: PadRow | null;
  reports: Report[];
  excerpt: { excerpt: string; length: number; size: number } | null;
};
type LogRow = { at: number; action: "clear" | "block" | "dismiss"; slug: string; category: string | null };
type Counts = { reported: number; blocked: number; active: number };
type Verb = "clear" | "block" | "dismiss";

const ICON_REFRESH =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/></svg>';
const ICON_COPY =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';

const fmtSize = (bytes: number | null): string => {
  if (bytes === null) return "-";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};
/** Relative time, with the exact moment in the tooltip. */
const when = (at: number | null) =>
  at === null ? "-" : `<time datetime="${new Date(at).toISOString()}" title="${esc(formatDateTime(at))}">${esc(ago(at))}</time>`;
const catLabel = (c: string | null) =>
  c && (CATEGORIES as readonly string[]).includes(c) ? t(`cat.${c}`) : (c ?? "");

/** Bytes against the room's cap. Past it the bar is full and flagged. */
function meter(size: number | null, big = false): string {
  if (size === null) return "";
  const over = size > MAX_DOC_BYTES;
  const pct = (size / MAX_DOC_BYTES) * 100;
  const width = size === 0 ? 0 : Math.min(100, Math.max(2, pct));
  return `<span class="meter${big ? " big" : ""}${over ? " over" : ""}" aria-hidden="true"><i style="width:${width.toFixed(1)}%"></i></span>`;
}
const capLabel = (size: number): string => {
  if (size > MAX_DOC_BYTES) return t("a.overcap");
  const pct = (size / MAX_DOC_BYTES) * 100;
  return t("a.ofcap", { pct: size > 0 && pct < 1 ? "<1" : String(Math.round(pct)) });
};

export function mountAdmin(app: HTMLElement, open: (slug: string) => void): () => void {
  app.innerHTML = `
    <section class="screen">
      <div class="admin">
        <div class="ahead"><h2 data-i18n="a.title"></h2><span class="tag" data-i18n="a.tag"></span>
          <div class="seg" id="aSeg">${ADMIN_FILTERS.map(
            (f) => `<button type="button" data-af="${f}" aria-pressed="false"></button>`,
          ).join("")}</div>
          <input type="search" id="aSearch" maxlength="64" data-i18n-ph="a.search" data-i18n-aria="a.search">
          <button type="button" class="iconbtn" id="aRefresh" data-i18n-aria="a.refresh" data-i18n-title="a.refresh">${ICON_REFRESH}</button>
        </div>
        <p class="help err" id="aErr" role="alert"></p>
        <p class="help ok" id="aOk" role="status"></p>
        <div class="acols">
          <div class="acol">
            <div class="tablewrap" id="aWrap"><table><thead><tr><th data-i18n="a.col.pad"></th><th class="hide-s" data-i18n="a.col.size"></th><th data-i18n="a.col.last"></th><th class="hide-s" data-i18n="a.col.edits"></th></tr></thead><tbody id="aBody"></tbody></table></div>
            <div class="tfoot"><span id="aCount"></span><span class="hide-s" data-i18n="a.kbd"></span></div>
          </div>
          <aside class="detail" id="aDetail" aria-live="polite"></aside>
        </div>
        <div><div class="eyebrow" style="margin-bottom:8px" data-i18n="a.log"></div><ul class="log" id="aLog"></ul></div>
      </div>
    </section>`;
  applyI18n(app);
  app.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle!);
  });

  const body = $("#aBody", app);
  const wrap = $("#aWrap", app);
  const detailEl = $("#aDetail", app);
  const logEl = $("#aLog", app);
  const errEl = $("#aErr", app);
  const okEl = $("#aOk", app);
  const countEl = $("#aCount", app);
  const search = $<HTMLInputElement>("#aSearch", app);
  const seg = $("#aSeg", app);
  const refreshBtn = $("#aRefresh", app);

  let filter: AdminFilter = "recent";
  let selected: string | null = null;
  let pending: "clear" | "block" | null = null;
  /** null until the first answer, so the page can say it is loading. */
  let rows: PadRow[] | null = null;
  let detail: Detail | null = null;
  /** The detail request failed: stop saying "Loading…"; the error line says why. */
  let detailFailed = false;
  let counts: Counts | null = null;
  let disposed = false;
  let rowsSeq = 0;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let detailTimer: ReturnType<typeof setTimeout> | undefined;

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`/api/admin/${path}`, {
      ...init,
      headers: init?.method === "POST" ? { "content-type": "application/json" } : undefined,
    });
    if (!res.ok) {
      const key =
        res.status === 401 || res.status === 403
          ? "a.denied"
          : res.status === 404
            ? "a.gone"
            : res.status === 409
              ? "a.already"
              : "a.err";
      throw new Error(t(key));
    }
    return (await res.json()) as T;
  }
  const fail = (e: unknown) => {
    okEl.textContent = "";
    errEl.textContent = e instanceof Error ? e.message : t("a.err");
  };
  const done = (message: string) => {
    errEl.textContent = "";
    okEl.textContent = message;
  };

  function renderTabs() {
    seg.querySelectorAll<HTMLElement>("[data-af]").forEach((b) => {
      const f = b.dataset.af as AdminFilter;
      const n = counts && f in counts ? counts[f as keyof Counts] : null;
      const hot = f === "reported" && n !== null && n > 0;
      b.innerHTML = `${esc(t(`a.f.${f}`))}${n === null ? "" : `<span class="n${hot ? " hot" : ""}">${n}</span>`}`;
      b.setAttribute("aria-pressed", String(f === filter));
      // The badge is a bare number; give the button a name that reads as "Reported, 3".
      if (n === null) b.removeAttribute("aria-label");
      else b.setAttribute("aria-label", `${t(`a.f.${f}`)}, ${n}`);
    });
  }

  function renderRows(refocus = false) {
    const hadFocus = refocus || body.contains(document.activeElement);
    renderTabs();
    if (rows === null) {
      body.innerHTML = `<tr><td colspan="4" class="empty">${esc(t("a.loading"))}</td></tr>`;
      wrap.setAttribute("aria-busy", "true");
      countEl.textContent = "";
      return;
    }
    wrap.removeAttribute("aria-busy");
    body.innerHTML =
      rows
        .map((p) => {
          const badge =
            p.status === "blocked"
              ? `<span class="badge blk">${esc(t("a.blocked"))}</span>`
              : p.status === "emptied"
                ? `<span class="badge emp">${esc(t("a.emptied"))}</span>`
                : p.reports
                  ? `<span class="badge rep">${esc(t("a.nreports", { n: String(p.reports) }))}</span>`
                  : "";
          const sel = p.slug === selected;
          return `<tr data-slug="${esc(p.slug)}" data-sel="${sel}"><td><button class="rowbtn" type="button"${sel ? ' aria-current="true"' : ""}>${esc(p.slug)}</button>${badge}</td><td class="hide-s"><span class="sz">${fmtSize(p.size)}</span>${meter(p.size)}</td><td>${when(p.last_edit)}</td><td class="hide-s">${p.edits ?? "-"}</td></tr>`;
        })
        .join("") || `<tr><td colspan="4" class="empty">${esc(t("a.none"))}</td></tr>`;
    countEl.textContent = rows.length
      ? t(rows.length >= ADMIN_LIST_LIMIT ? "a.shownCap" : "a.shown", { n: String(rows.length) })
      : "";
    if (hadFocus && selected) body.querySelector<HTMLElement>(`tr[data-sel="true"] .rowbtn`)?.focus();
  }

  function renderDetail() {
    if (!selected) {
      detailEl.innerHTML = `<p class="muted" style="margin:0">${esc(t("a.select"))}</p>`;
      return;
    }
    const head = `<div class="dhead"><h3>padline.page/${esc(selected)}</h3><button class="iconbtn" type="button" data-a="copy" aria-label="${esc(t("a.copy"))}" title="${esc(t("a.copy"))}">${ICON_COPY}</button></div>`;
    if (detail === null) {
      detailEl.innerHTML = detailFailed
        ? head
        : `${head}<p class="muted" style="margin:0">${esc(t("a.loading"))}</p>`;
      return;
    }
    const pad = detail.pad;
    const status = pad?.status ?? "live";
    const text = detail.excerpt?.excerpt ?? "";
    let confirm = "";
    if (pending) {
      const blk = pending === "block";
      confirm = `<div class="confirm"><p>${esc(t(blk ? "a.confirm.block" : "a.confirm.clear"))}</p>${
        blk
          ? `<label style="font-size:.8125rem;color:var(--ink-2)">${esc(t("a.cat"))} <select id="blkCat">${CATEGORIES.map((c) => `<option value="${c}">${esc(t(`cat.${c}`))}</option>`).join("")}</select></label>`
          : ""
      }<div class="acts"><button class="btn line" type="button" data-a="cancel">${esc(t("a.cancel"))}</button><button class="btn danger" type="button" data-a="confirm">${esc(t(blk ? "a.blockPad" : "a.clear"))}</button></div></div>`;
    }
    const reports = detail.reports;
    const badge = !pad
      ? ""
      : status === "blocked"
        ? `<span class="badge blk">${esc(t("a.blocked"))}</span>`
        : status === "emptied"
          ? `<span class="badge emp">${esc(t("a.emptied"))}</span>`
          : `<span class="badge ok">${esc(t("a.live"))}</span>`;
    const size = pad?.size ?? null;
    detailEl.innerHTML =
      head +
      (badge ? `<div>${badge}</div>` : "") +
      `<dl class="kv"><div><dt>${esc(t("a.col.size"))}</dt><dd>${fmtSize(size)}</dd></div><div><dt>${esc(t("a.created"))}</dt><dd>${when(pad?.created ?? null)}</dd></div><div><dt>${esc(t("a.col.last"))}</dt><dd>${when(pad?.last_edit ?? null)}</dd></div><div><dt>${esc(t("a.col.edits"))}</dt><dd>${pad?.edits ?? "-"}</dd></div></dl>` +
      (size !== null && status !== "blocked"
        ? `<div class="capbar">${meter(size, true)}<span>${esc(capLabel(size))}</span></div>`
        : "") +
      `<div class="excerpt">${text && status !== "blocked" ? esc(text).replace(/\n/g, "<br>") : `<i>${esc(t("a.noText"))}</i>`}</div>` +
      (reports.length
        ? `<div><div class="eyebrow" style="margin-bottom:8px">${esc(t("a.reports"))}</div><ul class="rlist">${reports
            .map(
              (r) =>
                `<li><span><b>${esc(catLabel(r.category))}</b>${r.note ? ` · ${esc(r.note)}` : ""}${r.contact ? ` · ${esc(r.contact)}` : ""}</span><span class="when">${when(r.created)}</span></li>`,
            )
            .join("")}</ul></div>`
        : "") +
      (confirm ||
        `<div class="acts"><button class="btn line" type="button" data-a="open">${esc(t("a.open"))}</button><button class="btn line" type="button" data-a="clear"${status !== "live" ? " disabled" : ""}>${esc(t("a.clear"))}</button><button class="btn danger" type="button" data-a="block"${status === "blocked" ? " disabled" : ""}>${esc(t("a.block"))}</button>${reports.length ? `<button class="btn line" type="button" data-a="dismiss">${esc(t("a.dismiss"))}</button>` : ""}</div>`);
  }

  async function loadLog() {
    const { actions } = await api<{ actions: LogRow[] }>("actions");
    if (disposed) return;
    logEl.innerHTML =
      actions
        .map(
          (x) =>
            `<li><time datetime="${new Date(x.at).toISOString()}">${esc(formatDateTime(x.at))}</time><span class="act ${esc(x.action)}">${esc(t(`a.act.${x.action}`))}</span><button class="slugbtn" type="button" data-pick="${esc(x.slug)}">${esc(x.slug)}</button>${x.category ? `<span>${esc(catLabel(x.category))}</span>` : ""}</li>`,
        )
        .join("") || `<li class="empty">${esc(t("a.logNone"))}</li>`;
  }

  async function loadCounts() {
    const res = await api<Counts>("counts");
    if (disposed) return;
    counts = res;
    renderTabs();
  }

  async function loadRows() {
    const q = search.value.trim().toLowerCase();
    // A slower, older answer must not overwrite a newer one.
    const seq = ++rowsSeq;
    let res: { pads: PadRow[] };
    try {
      res = await api<{ pads: PadRow[] }>(`pads?filter=${filter}&q=${encodeURIComponent(q)}`);
    } catch (e) {
      if (disposed || seq !== rowsSeq) return; // an older request's failure is not news
      throw e;
    }
    if (disposed || seq !== rowsSeq) return;
    rows = res.pads;
    renderRows();
  }

  async function loadDetail() {
    if (!selected) return renderDetail();
    const slug = selected;
    let res: Detail;
    try {
      res = await api<Detail>(`pads/${encodeURIComponent(slug)}`);
    } catch (e) {
      if (disposed || selected !== slug) return;
      detailFailed = true;
      renderDetail();
      throw e;
    }
    if (disposed || selected !== slug) return;
    detail = res;
    detailFailed = false;
    renderDetail();
  }

  /** Everything: after an action, or when the operator asks. */
  async function refreshAll() {
    errEl.textContent = "";
    refreshBtn.classList.add("busy");
    try {
      await Promise.all([loadRows(), loadCounts(), loadDetail(), loadLog()]);
    } catch (e) {
      fail(e);
    } finally {
      refreshBtn.classList.remove("busy");
    }
  }

  /** A search or filter change only needs the list. */
  async function refreshRows() {
    errEl.textContent = "";
    okEl.textContent = "";
    try {
      await loadRows();
    } catch (e) {
      fail(e);
    }
  }

  const stacked = () => detailEl.offsetTop >= wrap.offsetTop + wrap.offsetHeight - 2;

  /** `soon` waits a beat, so holding an arrow key does not ask the room for every row it passes. */
  function select(slug: string, opts: { soon?: boolean; reveal?: boolean } = {}) {
    selected = slug;
    pending = null;
    detail = null;
    detailFailed = false;
    okEl.textContent = "";
    renderRows(opts.soon);
    renderDetail();
    clearTimeout(detailTimer);
    detailTimer = setTimeout(() => void loadDetail().catch(fail), opts.soon ? 150 : 0);
    if (opts.reveal && stacked()) {
      const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
      detailEl.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" });
    }
  }

  seg.addEventListener("click", (e) => {
    const f = (e.target as HTMLElement).closest<HTMLElement>("[data-af]")?.dataset.af;
    if (!f || f === filter) return;
    filter = f as AdminFilter;
    renderTabs();
    void refreshRows();
  });
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void refreshRows(), 250);
  });
  refreshBtn.addEventListener("click", () => {
    okEl.textContent = "";
    void refreshAll();
  });
  body.addEventListener("click", (e) => {
    const slug = (e.target as HTMLElement).closest<HTMLElement>("tr[data-slug]")?.dataset.slug;
    if (slug) select(slug, { reveal: true });
  });
  logEl.addEventListener("click", (e) => {
    const slug = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]")?.dataset.pick;
    if (slug) select(slug, { reveal: true });
  });

  detailEl.addEventListener("click", async (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a;
    if (!a || !selected) return;
    if (a === "open") return open(selected);
    if (a === "copy") {
      try {
        await navigator.clipboard.writeText(`${location.origin}/${selected}`);
        done(t("a.copied"));
      } catch {
        // No clipboard (insecure context, or denied): nothing to report, nothing was changed.
      }
      return;
    }
    if (a === "clear" || a === "block") {
      pending = a;
      renderDetail();
      return;
    }
    if (a === "cancel") {
      pending = null;
      renderDetail();
      return;
    }
    const slug = selected;
    const verb: Verb | null =
      a === "dismiss" ? "dismiss" : a === "confirm" && pending ? pending : null;
    if (!verb) return;
    try {
      if (verb === "block") {
        const category = $<HTMLSelectElement>("#blkCat", detailEl).value;
        await api(`pads/${encodeURIComponent(slug)}/block`, {
          method: "POST",
          body: JSON.stringify({ category }),
        });
      } else {
        await api(`pads/${encodeURIComponent(slug)}/${verb}`, { method: "POST", body: "{}" });
      }
      pending = null;
      await refreshAll();
      if (!errEl.textContent) done(t(`a.done.${verb}`));
    } catch (err) {
      pending = null;
      fail(err);
      // The room may have acted even if the index write failed: show the truth.
      void refreshAll().then(() => fail(err));
    }
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
    if (e.key === "Escape" && pending) {
      pending = null;
      renderDetail();
      return;
    }
    if (typing) return;
    if (e.key === "/") {
      e.preventDefault();
      search.focus();
      return;
    }
    // Arrows move the selection only from the list itself and never while a
    // confirm is open; elsewhere they keep scrolling the page.
    const inList = (e.target as HTMLElement).closest("tbody") !== null;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && inList && !pending && rows?.length) {
      e.preventDefault();
      const i = rows.findIndex((p) => p.slug === selected);
      const next =
        i < 0
          ? e.key === "ArrowDown"
            ? 0
            : rows.length - 1
          : Math.min(rows.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)));
      if (rows[next].slug !== selected) select(rows[next].slug, { soon: true });
    }
  };
  document.addEventListener("keydown", onKey);

  renderRows();
  renderDetail();
  void refreshAll();
  return () => {
    disposed = true;
    clearTimeout(searchTimer);
    clearTimeout(detailTimer);
    document.removeEventListener("keydown", onKey);
  };
}
