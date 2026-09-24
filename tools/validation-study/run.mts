import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fromCsv, parseCsv, toCsv } from "../../apps/mobile/src/services/studyCsv";
import { analyse, TARGETS, type Metrics, type PanelReading } from "./analyse";
import { syntheticStudy } from "./synthetic";

/** Validation study (PRD M1–M4).
 *
 *   npm run study -- --study study.csv [--panel panel.csv]   real run (CSV exported from the app)
 *   npm run study -- --synthetic                              dry run on simulated captures
 *
 * panel.csv columns: study_id,rater,label  (label = PRELIMINARY_POSITIVE |
 * PRELIMINARY_NEGATIVE | INCONCLUSIVE), one row per rater per capture.
 * Writes metrics.json and a slide-ready report.html to tools/validation-study/dist. */

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = resolve(arg("out") ?? resolve(here, "dist"));
mkdirSync(out, { recursive: true });

let rows;
let synthetic = false;
if (args.includes("--synthetic")) {
  synthetic = true;
  const t = Date.now();
  rows = syntheticStudy();
  writeFileSync(resolve(out, "study-synthetic.csv"), toCsv(rows));
  console.log(`Synthetic study: ${rows.length} captures in ${((Date.now() - t) / 1000).toFixed(1)} s`);
} else {
  const file = arg("study");
  if (!file) {
    console.error("Usage: npm run study -- --study study.csv [--panel panel.csv]   or   --synthetic");
    process.exit(2);
  }
  rows = fromCsv(readFileSync(resolve(file), "utf8"));
}

let panel: PanelReading[] = [];
const panelFile = arg("panel");
if (panelFile) {
  const [header, ...lines] = parseCsv(readFileSync(resolve(panelFile), "utf8"));
  const col = (n: string) => header.indexOf(n);
  panel = lines.map((l) => ({ study_id: l[col("study_id")], rater: l[col("rater")], label: l[col("label")] }));
}

const m = analyse(rows, panel);
writeFileSync(resolve(out, "metrics.json"), JSON.stringify(m, null, 2) + "\n");

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const num = (v: number | null, d = 2) => (v === null ? "—" : v.toFixed(d));
const pass = (ok: boolean | null) => (ok === null ? "" : ok ? "✓" : "✗");

const m1ok = m.m1_accuracy === null ? null : m.m1_accuracy >= TARGETS.m1;
const m2ok = m.m2_inconclusive_good === null ? null : m.m2_inconclusive_good <= TARGETS.m2;
const m3ok = m.m3_calibrated_median === null ? null : m.m3_calibrated_median <= TARGETS.m3;
const m4ok = m.m4_kappa_app === null ? null : m.m4_kappa_app >= TARGETS.m4 && (m.m4_kappa_panel_mean === null || m.m4_kappa_app > m.m4_kappa_panel_mean);

function report(m: Metrics): string {
  const confRows = Object.entries(m.confusion)
    .map(([t, preds]) => `<tr><th>${t.replace(/_/g, " ")}</th>${["PRELIMINARY_POSITIVE", "PRELIMINARY_NEGATIVE", "INCONCLUSIVE"].map((p) => `<td>${preds[p] ?? 0}</td>`).join("")}</tr>`)
    .join("");
  const lightRows = Object.entries(m.per_lighting)
    .map(([l, v]) => `<tr><th>${l.replace(/_/g, " ")}</th><td>${v.n}</td><td>${pct(v.accuracy)}</td><td>${pct(v.inconclusive)}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Validation study</title><style>
  body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#0f1219;color:#f2f5fa}
  .slide{max-width:1100px;margin:0 auto;padding:28px 36px}
  h1{margin:0 0 4px;font-size:28px} .sub{color:#93a0b4;margin:0 0 18px}
  .sim{background:#7a1c1c;color:#fff;text-align:center;font-weight:800;letter-spacing:1px;padding:6px}
  .warn{background:#4a3710;color:#e0a33a;border:1px solid #e0a33a;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-weight:700}
  .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}
  .tile{background:#171c26;border:1px solid #28303d;border-radius:12px;padding:14px}
  .tile .k{color:#93a0b4;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
  .tile .v{font-size:34px;font-weight:800;margin:6px 0 2px} .tile .t{color:#93a0b4;font-size:13px}
  .ok{color:#3fbf7f} .bad{color:#e05252}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  table{border-collapse:collapse;width:100%;background:#171c26;border-radius:10px;overflow:hidden}
  th,td{padding:7px 10px;border-bottom:1px solid #28303d;text-align:left;font-size:14px} td{text-align:right}
  h2{font-size:15px;color:#93a0b4;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px}
  .foot{color:#6b7687;font-size:12px;margin-top:18px}
</style></head><body><div class="sim">SIMULATED — NOT A DRUG TEST</div><div class="slide">
<h1>Validation study — colour classification</h1>
<p class="sub">${m.n} captures · ${m.swatches} simulated swatches · ${m.lightings.length} lighting conditions · ${m.devices.length} device(s)</p>
${synthetic ? `<div class="warn">DRY RUN on synthetic captures (simulated camera and lights through the app's real pipeline). This proves the method and tooling; it is not a measurement of real-world accuracy. Replace with the phone study before presenting.</div>` : ""}
<div class="tiles">
  <div class="tile"><div class="k">M1 accuracy</div><div class="v ${m1ok ? "ok" : "bad"}">${pct(m.m1_accuracy)} ${pass(m1ok)}</div><div class="t">target ≥ 95% · ${m.m1_decided} decided (Inconclusive excluded)</div></div>
  <div class="tile"><div class="k">M2 inconclusive (GOOD)</div><div class="v ${m2ok ? "ok" : "bad"}">${pct(m.m2_inconclusive_good)} ${pass(m2ok)}</div><div class="t">target ≤ 10% · ${m.m2_good_n} GOOD captures · all: ${pct(m.inconclusive_rate_all)}</div></div>
  <div class="tile"><div class="k">M3 lighting invariance</div><div class="v ${m3ok ? "ok" : "bad"}">${num(m.m3_calibrated_median)} ${pass(m3ok)}</div><div class="t">median ΔE00 across lights, target ≤ 3.0 · raw ${num(m.m3_raw_median)}</div></div>
  <div class="tile"><div class="k">M4 Cohen's κ</div><div class="v ${m4ok ? "ok" : "bad"}">${num(m.m4_kappa_app, 3)} ${pass(m4ok)}</div><div class="t">app vs truth, target ≥ 0.9 · panel ${m.m4_kappa_panel_mean === null ? "not supplied" : num(m.m4_kappa_panel_mean, 3)}</div></div>
</div>
<div class="cols">
  <div><h2>Confusion matrix (rows = truth)</h2><table><tr><th></th><td><b>Positive</b></td><td><b>Negative</b></td><td><b>Inconclusive</b></td></tr>${confRows}</table></div>
  <div><h2>By lighting</h2><table><tr><th></th><td><b>n</b></td><td><b>accuracy</b></td><td><b>inconclusive</b></td></tr>${lightRows}</table></div>
</div>
<p class="foot">Accuracy excludes Inconclusive (the app is designed to say Inconclusive rather than guess). κ treats Inconclusive as its own label. Presumptive field test only — never a laboratory confirmation.</p>
</div></body></html>`;
}

writeFileSync(resolve(out, "report.html"), report(m));
console.log(`M1 accuracy          ${pct(m.m1_accuracy)} (${m.m1_decided} decided)   ${pass(m1ok)}`);
console.log(`M2 inconclusive GOOD ${pct(m.m2_inconclusive_good)} (all ${pct(m.inconclusive_rate_all)})   ${pass(m2ok)}`);
console.log(`M3 invariance        calibrated ${num(m.m3_calibrated_median)} vs raw ${num(m.m3_raw_median)} ΔE00   ${pass(m3ok)}`);
console.log(`M4 kappa             app ${num(m.m4_kappa_app, 3)} · panel ${m.m4_kappa_panel_mean === null ? "not supplied" : num(m.m4_kappa_panel_mean, 3)}   ${pass(m4ok)}`);
console.log(`\nWrote ${resolve(out, "report.html")}`);
