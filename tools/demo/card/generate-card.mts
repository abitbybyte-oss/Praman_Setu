import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { CORNER_ORDER, labToSrgb8, PATCH_ORDER, type CardLayout, type Lab } from "@fdtc/color-core";

/** Printable reference card (ARCHITECTURE §16 tools/demo).
 *
 * Reads the card layout and patch colours from the Reference DB source, so the
 * printed card and the app always agree on geometry. Output: an A4 HTML page
 * with the card drawn in real millimetres, a scale bar and print instructions.
 *
 *   npm run card   →   tools/demo/card/dist/fdtc-card-1.html  (open, print at 100%) */

const here = dirname(fileURLToPath(import.meta.url));
const refdbPath = resolve(here, "../../../packages/refdb/src/refdb.source.json");
const outDir = resolve(here, "dist");
const CARD_VERSION = "FDTC-CARD-1";

interface SourceCard {
  /** `lab` is the reference as printed; `print_lab`, when set, is what to print. */
  patches: { id: (typeof PATCH_ORDER)[number]; lab: Lab; print_lab?: Lab }[];
  layout: CardLayout;
}

interface SourceKit {
  display_name: string;
  classes: { id: string; outcome: string; label: string; exemplars_lab: Lab[] }[];
}
const refdb = JSON.parse(readFileSync(refdbPath, "utf8")) as {
  refdb_version: string;
  cards: Record<string, SourceCard>;
  kits: Record<string, SourceKit>;
};
const card = refdb.cards[CARD_VERSION];
if (!card?.layout) throw new Error(`${CARD_VERSION} has no layout in the Reference DB`);
const L = card.layout;

const printLab = (id: (typeof PATCH_ORDER)[number]): Lab => {
  const q = card.patches.find((x) => x.id === id)!;
  return q.print_lab ?? q.lab;
};

const hex = (lab: Lab) =>
  "#" +
  labToSrgb8(lab)
    .map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0"))
    .join("");

const PAPER = "#cbcbc9"; // neutral light gray so the white patch stands out from the card
const INK = "#000000";

const qrPayload = `FDTC-CARD|${CARD_VERSION}|SIMULATED`;
const qrSvg = await QRCode.toString(qrPayload, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
const qrInner = qrSvg.replace(/^[\s\S]*?<svg[^>]*viewBox="([^"]+)"[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const qrViewBox = /viewBox="([^"]+)"/.exec(qrSvg)![1];

function cardSvg(): string {
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${L.width_mm}" height="${L.height_mm}" rx="2" fill="${PAPER}" stroke="#888" stroke-width="0.2"/>`);

  for (const id of PATCH_ORDER) {
    const p = L.patches_mm[id];
    const lab = printLab(id);
    parts.push(`<rect x="${p.x}" y="${p.y}" width="${p.size}" height="${p.size}" fill="${hex(lab)}"/>`);
    parts.push(
      `<text x="${p.x + p.size / 2}" y="${p.y + p.size + 1.8}" font-size="1.6" text-anchor="middle" fill="#333">${id.toUpperCase()}</text>`
    );
  }

  for (const c of CORNER_ORDER) {
    const [x, y] = L.markers_mm[c];
    const r = L.marker_diameter_mm / 2;
    // Solid disc with a white centre dot: the dot is the exact tap target.
    parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}"/>`);
    parts.push(`<circle cx="${x}" cy="${y}" r="0.7" fill="#fff"/>`);
  }

  // QR with the card version, right of the patches.
  const qx = 80;
  const qy = 11;
  const qs = 20;
  parts.push(`<rect x="${qx - 1}" y="${qy - 1}" width="${qs + 2}" height="${qs + 2}" fill="#fff"/>`);
  parts.push(`<svg x="${qx}" y="${qy}" width="${qs}" height="${qs}" viewBox="${qrViewBox}">${qrInner}</svg>`);
  parts.push(`<text x="${qx + qs / 2}" y="${qy + qs + 3.5}" font-size="2.4" font-weight="700" text-anchor="middle">${CARD_VERSION}</text>`);
  parts.push(`<text x="${qx + qs / 2}" y="${qy + qs + 6.5}" font-size="1.8" text-anchor="middle">Praman Setu reference card</text>`);
  parts.push(`<text x="${qx + qs / 2}" y="${qy + qs + 9}" font-size="1.6" text-anchor="middle" fill="#444">Tap the 4 black dots</text>`);
  parts.push(`<text x="${qx + qs / 2}" y="${qy + qs + 11.2}" font-size="1.6" text-anchor="middle" fill="#444">TL → TR → BR → BL</text>`);

  parts.push(
    `<text x="${L.width_mm / 2}" y="${L.height_mm - 4.2}" font-size="3" font-weight="800" text-anchor="middle" fill="#8b1a1a" letter-spacing="0.2">SIMULATED — NOT A DRUG TEST</text>`
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.width_mm}mm" height="${L.height_mm}mm" viewBox="0 0 ${L.width_mm} ${L.height_mm}" font-family="Arial, Helvetica, sans-serif">${parts.join("")}</svg>`;
}

const scaleBar = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="8mm" viewBox="0 0 100 8" font-family="Arial, sans-serif">
  ${Array.from({ length: 11 }, (_, i) => `<line x1="${i * 10}" y1="0" x2="${i * 10}" y2="${i % 5 ? 3 : 5}" stroke="#000" stroke-width="0.3"/>`).join("")}
  <line x1="0" y1="0" x2="100" y2="0" stroke="#000" stroke-width="0.4"/>
  <text x="0" y="7.5" font-size="2.5">0</text><text x="50" y="7.5" font-size="2.5" text-anchor="middle">50 mm</text><text x="100" y="7.5" font-size="2.5" text-anchor="end">100 mm</text>
</svg>`;

const swatchRows = PATCH_ORDER.map((id) => {
  const lab = printLab(id);
  const rgb = labToSrgb8(lab).map((v) => Math.round(v));
  return `<tr><td><span class="sw" style="background:${hex(lab)}"></span>${id}</td><td>${lab.join(", ")}</td><td>${rgb.join(", ")}</td><td>${hex(lab)}</td></tr>`;
}).join("");

// Simulated reaction swatches: one disc per kit class (first exemplar), so a
// demo can produce each outcome without any real reagent.
const swatches = Object.entries(refdb.kits)
  .map(([type, kit]) => {
    const discs = kit.classes
      .map((c) => {
        const lab = c.exemplars_lab[0];
        const tag = c.outcome === "PRELIMINARY_POSITIVE" ? "POS" : "NEG";
        return `<div class="swd"><svg width="26mm" height="26mm" viewBox="0 0 26 26"><rect width="26" height="26" fill="#fff"/><circle cx="13" cy="13" r="11" fill="${hex(lab)}"/></svg><div>${type} ${tag}</div><div class="mut">${c.id}</div></div>`;
      })
      .join("");
    return `<div class="swk"><b>${kit.display_name}</b><div class="swrow">${discs}</div></div>`;
  })
  .join("");

const svg = cardSvg();
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${CARD_VERSION} printable card</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; }
  .sheet { width: 186mm; }
  h1 { font-size: 15pt; margin: 0 0 2mm; }
  p, li { font-size: 9.5pt; line-height: 1.4; margin: 1mm 0; }
  .cards { display: grid; grid-template-columns: 110mm; gap: 6mm; margin: 5mm 0; }
  table { border-collapse: collapse; font-size: 8.5pt; margin-top: 3mm; }
  td, th { border: 0.2mm solid #bbb; padding: 1mm 2mm; text-align: left; }
  .sw { display: inline-block; width: 4mm; height: 4mm; margin-right: 2mm; vertical-align: middle; border: 0.2mm solid #999; }
  .warn { color: #8b1a1a; font-weight: 700; }
  .swgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-top: 3mm; }
  .swk { border: 0.2mm solid #bbb; padding: 2mm; font-size: 9pt; }
  .swrow { display: flex; gap: 4mm; margin-top: 1.5mm; }
  .swd { text-align: center; font-size: 8pt; }
  .mut { color: #666; font-size: 7pt; }
  .pb { break-before: page; }
  @media screen { body { background: #eee; } .sheet { background: #fff; margin: 10mm auto; padding: 12mm; box-shadow: 0 0 4mm #0003; } }
</style></head>
<body><div class="sheet">
  <h1>${CARD_VERSION} — printable reference card</h1>
  <p class="warn">SIMULATED — NOT A DRUG TEST. For the Praman Setu prototype demo only.</p>
  <ol>
    <li>Print on <b>matte white card stock</b> with <b>Scale 100% / Actual size</b>. Turn off "fit to page".</li>
    <li>Check the scale bar below measures exactly 100 mm. If not, the app will still work, but reprint for the demo.</li>
    <li>Cut out one card. Keep it flat, clean and out of sunlight; the patch colours are the calibration reference.</li>
    <li>In the app, photograph the card next to the kit, then tap the 4 black dots in order: top-left, top-right, bottom-right, bottom-left (card upright, text readable).</li>
  </ol>
  <div>${scaleBar}</div>
  <div class="cards">${svg}${svg}</div>
  <p><b>Printed colours will not exactly match these values.</b> For the validation study, measure the printed patches (spectrophotometer, or averaged captures under daylight) and update <code>packages/refdb/src/refdb.source.json</code>, then rebuild the Reference DB.</p>
  <table><tr><th>Patch</th><th>Reference Lab (D65)</th><th>sRGB</th><th>Hex</th></tr>${swatchRows}</table>
  <h1 class="pb">Simulated reaction swatches</h1>
  <p class="warn">SIMULATED — NOT A DRUG TEST. Printed colours stand in for a kit's reaction area.</p>
  <p>Cut out a disc and place it where the kit's reaction area would be, next to the reference card. Select the matching kit type in the app. A POS disc should read as <i>Simulated Preliminary Positive</i>, a NEG disc as <i>Simulated Preliminary Negative</i>; anything else reads Inconclusive. Printer colour error can push a disc outside its class — that is the Inconclusive path working as designed.</p>
  <div class="swgrid">${swatches}</div>
  <p style="margin-top:3mm;color:#555">Generated from Reference DB ${refdb.refdb_version}. Card QR payload: <code>${qrPayload}</code></p>
</div></body></html>
`;

mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, `${CARD_VERSION.toLowerCase()}.html`);
writeFileSync(out, html);
writeFileSync(resolve(outDir, `${CARD_VERSION.toLowerCase()}.svg`), svg);
console.log(`Wrote ${out}`);
console.log(`Open it in a browser and print at 100% (Actual size).`);
