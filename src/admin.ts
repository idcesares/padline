import { ADMIN_FILTERS, type AdminFilter, CATEGORIES } from "../shared/moderation";
import { $, esc } from "./dom";
import { ago, applyI18n, formatDate, t } from "./i18n";

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

const fmtSize = (bytes: number | null): string => {
  if (bytes === null) return "-";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};
const when = (at: number | null) => (at === null ? "-" : ago(at));
const catLabel = (c: string | null) =>
  c && (CATEGORIES as readonly string[]).includes(c) ? t(`cat.${c}`) : (c ?? "");

export function mountAdmin(app: HTMLElement, open: (slug: string) => void): () => void {
  app.innerHTML = `
    <section class="screen">
      <div class="admin">
        <div class="ahead"><h2 data-i18n="a.title"></h2><span class="tag" data-i18n="a.tag"></span>
          <div class="seg" id="aSeg">${ADMIN_FILTERS.map(
            (f) => `<button type="button" data-af="${f}" aria-pressed="false" data-i18n="a.f.${f}"></button>`,
          ).join("")}</div>
          <input type="search" id="aSearch" maxlength="64" data-i18n-ph="a.search" data-i18n-aria="a.search">
        </div>
        <p class="help err" id="aErr" role="alert"></p>
        <div class="acols">
          <div class="tablewrap"><table><thead><tr><th data-i18n="a.col.pad"></th><th class="hide-s" data-i18n="a.col.size"></th><th data-i18n="a.col.last"></th><th class="hide-s" data-i18n="a.col.edits"></th></tr></thead><tbody id="aBody"></tbody></table></div>
          <aside class="detail" id="aDetail" aria-live="polite"></aside>
        </div>
        <div><div class="eyebrow" style="margin-bottom:8px" data-i18n="a.log"></div><ul class="log" id="aLog"></ul></div>
      </div>
    </section>`;
  applyI18n(app);

  const body = $("#aBody", app);
  const detailEl = $("#aDetail", app);
  const logEl = $("#aLog", app);
  const errEl = $("#aErr", app);
  const search = $<HTMLInputElement>("#aSearch", app);
  const seg = $("#aSeg", app);

  let filter: AdminFilter = "recent";
  let selected: string | null = null;
  let pending: "clear" | "block" | null = null;
  let rows: PadRow[] = [];
  let detail: Detail | null = null;
  let disposed = false;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`/api/admin/${path}`, {
      ...init,
      headers: init?.method === "POST" ? { "content-type": "application/json" } : undefined,
    });
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? t("a.denied") : t("a.err"));
    return (await res.json()) as T;
  }
  const fail = (e: unknown) => {
    errEl.textContent = e instanceof Error ? e.message : t("a.err");
  };

  function renderRows() {
    seg.querySelectorAll<HTMLElement>("[data-af]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.af === filter));
    });
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
          return `<tr data-slug="${esc(p.slug)}" aria-selected="${p.slug === selected}"><td><button class="rowbtn" type="button">${esc(p.slug)}</button>${badge}</td><td class="hide-s">${fmtSize(p.size)}</td><td>${esc(when(p.last_edit))}</td><td class="hide-s">${p.edits ?? "-"}</td></tr>`;
        })
        .join("") || `<tr><td colspan="4" style="padding:18px">${esc(t("a.none"))}</td></tr>`;
  }

  function renderDetail() {
    if (!selected) {
      detailEl.innerHTML = `<p style="margin:0;color:var(--ink-2)">${esc(t("a.select"))}</p>`;
      return;
    }
    const pad = detail?.pad ?? null;
    const status = pad?.status ?? "live";
    const text = detail?.excerpt?.excerpt ?? "";
    let confirm = "";
    if (pending) {
      const blk = pending === "block";
      confirm = `<div class="confirm"><p>${esc(t(blk ? "a.confirm.block" : "a.confirm.clear"))}</p>${
        blk
          ? `<label style="font-size:.8125rem;color:var(--ink-2)">${esc(t("a.cat"))} <select id="blkCat">${CATEGORIES.map((c) => `<option value="${c}">${esc(t(`cat.${c}`))}</option>`).join("")}</select></label>`
          : ""
      }<div class="acts"><button class="btn line" type="button" data-a="cancel">${esc(t("a.cancel"))}</button><button class="btn danger" type="button" data-a="confirm">${esc(t(blk ? "a.blockPad" : "a.clear"))}</button></div></div>`;
    }
    const reports = detail?.reports ?? [];
    detailEl.innerHTML =
      `<h3>padline.page/${esc(selected)}</h3>` +
      `<dl class="kv"><div><dt>${esc(t("a.col.size"))}</dt><dd>${fmtSize(pad?.size ?? null)}</dd></div><div><dt>${esc(t("a.created"))}</dt><dd>${pad?.created ? esc(formatDate(pad.created)) : "-"}</dd></div><div><dt>${esc(t("a.col.last"))}</dt><dd>${esc(when(pad?.last_edit ?? null))}</dd></div><div><dt>${esc(t("a.col.edits"))}</dt><dd>${pad?.edits ?? "-"}</dd></div></dl>` +
      `<div class="excerpt">${text && status !== "blocked" ? esc(text).replace(/\n/g, "<br>") : `<i>${esc(t("a.noText"))}</i>`}</div>` +
      (reports.length
        ? `<div><div class="eyebrow" style="margin-bottom:8px">${esc(t("a.reports"))}</div><ul class="rlist">${reports
            .map(
              (r) =>
                `<li><span><b>${esc(catLabel(r.category))}</b>${r.note ? ` · ${esc(r.note)}` : ""}${r.contact ? ` · ${esc(r.contact)}` : ""}</span><span>${esc(formatDate(r.created))}</span></li>`,
            )
            .join("")}</ul></div>`
        : "") +
      (confirm ||
        `<div class="acts"><button class="btn line" type="button" data-a="open">${esc(t("a.open"))}</button><button class="btn line" type="button" data-a="clear"${status !== "live" ? " disabled" : ""}>${esc(t("a.clear"))}</button><button class="btn danger" type="button" data-a="block"${status === "blocked" ? " disabled" : ""}>${esc(t("a.block"))}</button>${reports.length ? `<button class="btn line" type="button" data-a="dismiss">${esc(t("a.dismiss"))}</button>` : ""}</div>`);
  }

  async function loadLog() {
    const { actions } = await api<{ actions: LogRow[] }>("actions");
    logEl.innerHTML = actions
      .map(
        (x) =>
          `<li>${esc(formatDate(x.at))} · <b>${esc(t(`a.act.${x.action}`))}</b> · ${esc(x.slug)}${x.category ? ` · ${esc(catLabel(x.category))}` : ""}</li>`,
      )
      .join("");
  }

  async function loadRows() {
    const q = search.value.trim().toLowerCase();
    const res = await api<{ pads: PadRow[] }>(`pads?filter=${filter}&q=${encodeURIComponent(q)}`);
    if (disposed) return;
    rows = res.pads;
    renderRows();
  }

  async function loadDetail() {
    detail = null;
    if (selected) {
      const slug = selected;
      const res = await api<Detail>(`pads/${encodeURIComponent(slug)}`);
      if (disposed || selected !== slug) return;
      detail = res;
    }
    renderDetail();
  }

  async function refresh() {
    errEl.textContent = "";
    try {
      await Promise.all([loadRows(), loadDetail(), loadLog()]);
    } catch (e) {
      fail(e);
    }
  }

  seg.addEventListener("click", (e) => {
    const f = (e.target as HTMLElement).closest<HTMLElement>("[data-af]")?.dataset.af;
    if (!f || f === filter) return;
    filter = f as AdminFilter;
    void refresh();
  });
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void refresh(), 250);
  });
  body.addEventListener("click", (e) => {
    const slug = (e.target as HTMLElement).closest<HTMLElement>("tr[data-slug]")?.dataset.slug;
    if (!slug) return;
    selected = slug;
    pending = null;
    renderRows();
    void loadDetail().catch(fail);
  });
  detailEl.addEventListener("click", async (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a;
    if (!a || !selected) return;
    if (a === "open") return open(selected);
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
    try {
      if (a === "confirm" && pending === "block") {
        const category = $<HTMLSelectElement>("#blkCat", detailEl).value;
        await api(`pads/${encodeURIComponent(slug)}/block`, {
          method: "POST",
          body: JSON.stringify({ category }),
        });
      } else if (a === "confirm" && pending === "clear") {
        await api(`pads/${encodeURIComponent(slug)}/clear`, { method: "POST", body: "{}" });
      } else if (a === "dismiss") {
        await api(`pads/${encodeURIComponent(slug)}/dismiss`, { method: "POST", body: "{}" });
      } else {
        return;
      }
      pending = null;
      await refresh();
    } catch (err) {
      pending = null;
      fail(err);
      // The room may have acted even if the index write failed: show the truth.
      void refresh().then(() => fail(err));
    }
  });

  renderDetail();
  void refresh();
  return () => {
    disposed = true;
    clearTimeout(searchTimer);
  };
}
