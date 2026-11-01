import "./style.css";
import { checkSlug, normalizeSlug } from "../shared/slug";
import { mountAbout } from "./about";
import { mountEditor } from "./editor";
import { t } from "./i18n";
import { mountLanding } from "./landing";
import { renderNotice } from "./notice";
import { applyTheme } from "./prefs";
import { mountReport } from "./report";

applyTheme();

const app = document.getElementById("app");
if (!app) throw new Error("missing #app");

const TITLE = "Padline";
let dispose: (() => void) | null = null;
/** Bumped on every render so a late-arriving admin chunk cannot mount over a newer view. */
let adminMount = 0;

function decodePath(pathname: string): string {
  const trimmed = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function navigate(path: string): void {
  history.pushState(null, "", path);
  render();
}

function home(): void {
  navigate("/");
}

function render(): void {
  dispose?.();
  dispose = null;
  adminMount++;
  app!.replaceChildren();

  const raw = decodePath(location.pathname);
  if (raw === "") {
    document.title = TITLE;
    dispose = mountLanding(app!, (slug) => navigate(`/${slug}`));
    return;
  }

  // All of these are reserved slugs, so they can never be a pad.
  if (raw === "report") {
    document.title = `${t("r.title")} · ${TITLE}`;
    const pad = normalizeSlug(new URLSearchParams(location.search).get("pad") ?? "");
    dispose = mountReport(app!, pad, home);
    return;
  }
  if (raw === "about") {
    document.title = `${t("ab.title")} · ${TITLE}`;
    dispose = mountAbout(app!, home);
    return;
  }
  if (raw === "admin") {
    document.title = `Admin · ${TITLE}`;
    const mounted = ++adminMount;
    // Lazy: visitors never download the operator's page.
    void import("./admin").then(({ mountAdmin }) => {
      if (mounted !== adminMount) return;
      dispose = mountAdmin(app!, (slug) => navigate(`/${slug}`));
    });
    return;
  }

  const slug = normalizeSlug(raw);
  const verdict = raw.includes("/") ? "invalid" : checkSlug(slug);
  document.title = `${slug || raw} · ${TITLE}`;

  if (verdict !== "ok") {
    renderNotice(app!, {
      title: t(verdict === "reserved" ? "st.reserved.t" : "st.invalid.t"),
      body: t(verdict === "reserved" ? "l.err.reserved" : "l.err.invalid"),
      actions: [{ label: t("e.home"), primary: true, run: home }],
    });
    return;
  }

  if (slug !== raw) history.replaceState(null, "", `/${slug}`);
  dispose = mountEditor(app!, slug, {
    home,
    reload: render,
    report: () => navigate(`/report?pad=${encodeURIComponent(slug)}`),
  });
}

window.addEventListener("popstate", render);
render();
