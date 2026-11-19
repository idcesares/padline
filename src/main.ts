import "./style.css";
import { checkSlug, normalizeSlug } from "../shared/slug";
import { mountAbout } from "./about";
import { t } from "./i18n";
import { mountLanding } from "./landing";
import { renderNotice } from "./notice";
import { applyTheme } from "./prefs";
import { mountReport } from "./report";
import { createRouteLoader } from "./route-loader";

applyTheme();

const app = document.getElementById("app");
if (!app) throw new Error("missing #app");

const TITLE = "Padline";
let dispose: (() => void) | null = null;
/** Discard chunks that finish after the visitor has navigated elsewhere. */
const routeLoader = createRouteLoader();

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
  routeLoader.cancel();
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
    loadView(() => import("./admin"), ({ mountAdmin }) => {
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
  loadView(() => import("./editor"), ({ mountEditor }) => {
    dispose = mountEditor(app!, slug, {
      home,
      reload: render,
      report: () => navigate(`/report?pad=${encodeURIComponent(slug)}`),
    });
  });
}

function loadView<T>(load: () => Promise<T>, mount: (module: T) => void): void {
  const status = document.createElement("p");
  status.className = "route-loading";
  status.setAttribute("role", "status");
  status.textContent = t("route.loading");
  app!.replaceChildren(status);
  void routeLoader.load(load, mount, () => {
    renderNotice(app!, {
      title: t("route.error"),
      body: t("route.errorBody"),
      actions: [
        { label: t("st.retry"), primary: true, run: render },
        { label: t("e.home"), run: home },
      ],
    });
  });
}

window.addEventListener("popstate", render);
render();
