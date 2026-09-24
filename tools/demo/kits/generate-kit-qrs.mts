import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

import { checkKitQr, formatKitQr, type KitQr } from "../../../apps/mobile/src/services/kitqr";

/** Printable simulated kit QR labels (PRD DEMO-06, TC-04..07).
 *
 *   npm run kits   →   tools/demo/kits/dist/kit-labels.html  (print at 100%)
 *
 * Every label's expected status is computed with the app's own rule, so the
 * printed sheet and the app cannot disagree. */

const here = dirname(fileURLToPath(import.meta.url));
const refdb = JSON.parse(readFileSync(resolve(here, "../../../packages/refdb/src/refdb.source.json"), "utf8"));
const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (n: number) => iso(new Date(today.getTime() + n * 86_400_000));

const base = { manufacturer: "Demo Labs", batch: "B2026-07", mfg_date: "2026-01-10", expiry_date: addDays(365) };
const labels: { title: string; payload: string; note: string }[] = [
  ...["SIM-A", "SIM-B", "SIM-C", "SIM-D"].map((type, i) => {
    const kit: KitQr = { ...base, kit_id: `SIMKIT-00${871 + i}`, kit_type: type };
    return { title: `${refdb.kits[type].display_name}`, payload: formatKitQr(kit), note: "Use for the demo" };
  }),
  {
    title: "Expired kit (TC-05)",
    payload: formatKitQr({ ...base, kit_id: "SIMKIT-000500", kit_type: "SIM-A", mfg_date: "2025-01-10", expiry_date: addDays(-30) }),
    note: "Must show: Kit not valid — do not use",
  },
  {
    title: "Not yet valid",
    payload: formatKitQr({ ...base, kit_id: "SIMKIT-000900", kit_type: "SIM-B", mfg_date: addDays(60), expiry_date: addDays(425) }),
    note: "Manufacture date in the future",
  },
  {
    title: "Unknown manufacturer",
    payload: formatKitQr({ ...base, kit_id: "SIMKIT-000777", kit_type: "SIM-A", manufacturer: "Acme Reagents" }),
    note: "Not on the approved list",
  },
  { title: "Not a kit QR (TC-07)", payload: "https://example.com/not-a-kit", note: "Random QR — must not crash" },
];

const cells: string[] = [];
for (const l of labels) {
  const check = checkKitQr(l.payload, refdb, iso(today));
  const svg = await QRCode.toString(l.payload, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  const colour = check.status === "VALID" ? "#1d7a45" : "#8b1a1a";
  cells.push(`<div class="label">
    <div class="qr">${svg}</div>
    <div class="txt">
      <div class="t">${l.title}</div>
      <div class="s" style="color:${colour}">Expected: ${check.status}${check.problem ? ` (${check.problem})` : ""}</div>
      <div class="n">${l.note}</div>
      <div class="sim">SIMULATED — NOT A DRUG TEST</div>
      <code>${l.payload.replace(/\|/g, "|<wbr>")}</code>
    </div>
  </div>`);
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Simulated kit QR labels</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #111; }
  .sheet { width: 190mm; }
  h1 { font-size: 14pt; margin: 0 0 1mm; } p { font-size: 9pt; margin: 1mm 0 3mm; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
  .label { display: flex; gap: 3mm; border: 0.3mm dashed #999; padding: 3mm; break-inside: avoid; }
  .qr svg { width: 34mm; height: 34mm; display: block; }
  .txt { font-size: 8.5pt; display: flex; flex-direction: column; gap: 0.8mm; min-width: 0; }
  .t { font-weight: 700; font-size: 10pt; } .s { font-weight: 700; } .n { color: #444; }
  .sim { color: #8b1a1a; font-weight: 800; font-size: 7.5pt; }
  code { font-size: 6.5pt; color: #555; word-break: break-all; }
  @media screen { body { background: #eee; } .sheet { background: #fff; margin: 8mm auto; padding: 10mm; } }
</style></head><body><div class="sheet">
<h1>Simulated kit QR labels</h1>
<p class="sim">SIMULATED — NOT A DRUG TEST. Print at 100%, cut along the dashed lines, stick a label on each simulated kit pouch. Generated ${iso(today)}; expiry dates are relative to this day.</p>
<div class="grid">${cells.join("")}</div>
</div></body></html>`;

const out = resolve(here, "dist");
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, "kit-labels.html"), html);
for (const l of labels) console.log(`${checkKitQr(l.payload, refdb, iso(today)).status.padEnd(14)} ${l.title}`);
console.log(`\nWrote ${resolve(out, "kit-labels.html")}`);
