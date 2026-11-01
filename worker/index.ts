import { routePartykitRequest } from "partyserver";
import { isValidSlug } from "../shared/slug";
import { authorizeAdmin } from "./access";
import { handleAdmin, handleReport } from "./moderation";
import type { Env } from "./pad-room";

export { PadRoom } from "./pad-room";
// Kept only so migration v2 stays valid; see the file.
export { ModerationLedger } from "./moderation-ledger";

const CANONICAL_HOST = "padline.page";
const ALIAS_HOSTS = new Set(["www.padline.page", "padline.dcesares.dev"]);

const CRAWLER_RE =
  /facebookexternalhit|twitterbot|slackbot|discordbot|linkedinbot|whatsapp|telegrambot|googlebot|bingbot/i;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Link previews for a pad address. Never reads the pad (ADR-0001). */
function previewResponse(slug: string, origin: string): Response {
  const title = escapeHtml(`/${slug} · Padline`);
  const description = "A shared pad. Open the link to read and edit together.";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="robots" content="noindex">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:url" content="${origin}/${slug}">
<meta name="twitter:card" content="summary">
</head>
<body><p>${title}</p></body>
</html>`;
  return new Response(html, {
    headers: { "content-type": "text/html;charset=utf-8" },
  });
}

function csp(hostname: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // Google Fonts serves the stylesheet and the font files (docs/design).
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    // Explicit wss entry: not every browser maps same-origin ws under 'self'.
    `connect-src 'self' wss://${hostname}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    // form-action does not fall back to default-src. Padline has no <form>
    // that posts anywhere: everything goes over fetch and WebSocket.
    "form-action 'none'",
  ].join("; ");
}

// One year, no `preload`: preloading is effectively irreversible. Safe for
// includeSubDomains because every padline.page host is an HTTPS custom domain.
const HSTS = "max-age=31536000; includeSubDomains";

function withSecurityHeaders(response: Response, hostname: string): Response {
  const res = new Response(response.body, response);
  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("referrer-policy", "no-referrer");
  // CSP and HSTS are production-only: Vite dev injects inline scripts, and a
  // year of forced HTTPS must never pin against localhost.
  const isDev = hostname === "localhost" || hostname === "127.0.0.1";
  if (!isDev) {
    res.headers.set("content-security-policy", csp(hostname));
    res.headers.set("strict-transport-security", HSTS);
  }
  return res;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // www and the alternate domain redirect so pad links resolve to one origin.
    if (ALIAS_HOSTS.has(url.hostname)) {
      url.hostname = CANONICAL_HOST;
      return Response.redirect(url.toString(), 301);
    }

    // ADR-0002: a room's admin operations are never public. They are RPC calls
    // from handleAdmin; this refusal keeps an `op=admin-*` query from ever
    // becoming a second way in.
    if (
      url.pathname.startsWith("/parties/") &&
      url.searchParams.get("op")?.startsWith("admin-")
    ) {
      return Response.json({ error: "unknown-op" }, { status: 404 });
    }

    const roomResponse = await routePartykitRequest(request, env as never);
    if (roomResponse) return roomResponse;

    // Dormant while run_worker_first excludes /assets/* (ADR-0004): the asset
    // router answers those. Written to stay correct if that is ever dropped,
    // and to never answer a missing chunk with the HTML shell.
    if (url.pathname.startsWith("/assets/")) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status === 404) {
        return withSecurityHeaders(
          new Response("Not found", {
            status: 404,
            headers: {
              "content-type": "text/plain;charset=utf-8",
              "cache-control": "no-store",
            },
          }),
          url.hostname,
        );
      }
      return withSecurityHeaders(asset, url.hostname);
    }

    if (url.pathname === "/api/health") {
      return withSecurityHeaders(Response.json({ ok: true }), url.hostname);
    }
    if (url.pathname === "/api/report") {
      return withSecurityHeaders(await handleReport(request, env), url.hostname);
    }
    if (url.pathname.startsWith("/api/admin/")) {
      return withSecurityHeaders(await handleAdmin(request, env), url.hostname);
    }
    if (url.pathname.startsWith("/api/")) {
      return withSecurityHeaders(
        Response.json({ error: "not-found" }, { status: 404 }),
        url.hostname,
      );
    }

    // The admin shell is the same static page as everything else, but only
    // someone Access has let in gets it. The data behind it checks again.
    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      const auth = await authorizeAdmin(request, env);
      if (!auth.ok) {
        return withSecurityHeaders(
          new Response(auth.status === 401 ? "Unauthorized" : "Forbidden", {
            status: auth.status,
            headers: { "content-type": "text/plain;charset=utf-8", "cache-control": "no-store" },
          }),
          url.hostname,
        );
      }
    }

    const slug = url.pathname.slice(1);
    if (isValidSlug(slug) && CRAWLER_RE.test(request.headers.get("user-agent") ?? "")) {
      return withSecurityHeaders(previewResponse(slug, url.origin), url.hostname);
    }

    // not_found_handling is "none" (ADR-0004), so an address is not a file and
    // the shell is served explicitly. The client decides what an address means.
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return withSecurityHeaders(asset, url.hostname);
    const shell = await env.ASSETS.fetch(new URL("/index.html", url.origin));
    return withSecurityHeaders(shell, url.hostname);
  },
} satisfies ExportedHandler<Env>;
