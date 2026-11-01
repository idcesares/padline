// QR code for the share dialog. Drawn as one SVG path with DOM calls, so it
// needs no image source and fits the CSP. Always dark on light with a quiet
// zone (the tile adds a white border): scanners need the contrast, whatever the page theme is.

import qrcode from "qrcode-generator";

const SVG_NS = "http://www.w3.org/2000/svg";
const QUIET = 2;

/** Replaces `target`'s content with a QR code of `text`. */
export function renderQr(target: HTMLElement, text: string, name: string): void {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + QUIET * 2;
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.isDark(y, x)) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
    }
  }
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", name);
  svg.setAttribute("focusable", "false");
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("width", String(size));
  bg.setAttribute("height", String(size));
  bg.setAttribute("fill", "#fff");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#0b0d12");
  svg.append(bg, path);
  target.replaceChildren(svg);
}
