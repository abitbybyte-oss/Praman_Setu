import { deltaE00, type Lab } from "@fdtc/color-core";

import type { StudyRow } from "../../apps/mobile/src/services/studyCsv";

/** Validation-study metrics (PRD §10 M1–M4). Pure; used by the CLI and tests. */

export const LABELS = ["PRELIMINARY_POSITIVE", "PRELIMINARY_NEGATIVE", "INCONCLUSIVE"] as const;

export interface PanelReading {
  study_id: string;
  rater: string;
  /** PRELIMINARY_POSITIVE | PRELIMINARY_NEGATIVE | INCONCLUSIVE */
  label: string;
}

export interface Metrics {
  n: number;
  swatches: number;
  lightings: string[];
  devices: string[];
  /** M1: correct / decided (Inconclusive excluded). */
  m1_accuracy: number | null;
  m1_decided: number;
  /** M2: Inconclusive among GOOD-quality captures. */
  m2_inconclusive_good: number | null;
  m2_good_n: number;
  inconclusive_rate_all: number;
  /** M3: median ΔE00 between readings of the same swatch across lightings. */
  m3_calibrated_median: number | null;
  m3_raw_median: number | null;
  /** M4: Cohen's κ vs truth (app over all captures, Inconclusive counted as its own label). */
  m4_kappa_app: number | null;
  m4_kappa_panel_mean: number | null;
  m4_kappa_panel_by_rater: Record<string, number>;
  confusion: Record<string, Record<string, number>>;
  per_lighting: Record<string, { n: number; accuracy: number | null; inconclusive: number }>;
}

/** Cohen's κ for two label sequences of equal length. */
export function cohensKappa(a: string[], b: string[]): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  const labels = [...new Set([...a, ...b])];
  const n = a.length;
  let agree = 0;
  const ca: Record<string, number> = {};
  const cb: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++;
    ca[a[i]] = (ca[a[i]] ?? 0) + 1;
    cb[b[i]] = (cb[b[i]] ?? 0) + 1;
  }
  const po = agree / n;
  const pe = labels.reduce((s, l) => s + ((ca[l] ?? 0) / n) * ((cb[l] ?? 0) / n), 0);
  return pe === 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe);
}

function median(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median over swatches of the ΔE00 between per-lighting mean readings. */
function lightingInvariance(rows: StudyRow[], pick: (r: StudyRow) => Lab | null): number | null {
  const bySwatch = new Map<string, Map<string, Lab[]>>();
  for (const r of rows) {
    const lab = pick(r);
    if (!lab) continue;
    const sw = `${r.device}|${r.true_class}`;
    if (!bySwatch.has(sw)) bySwatch.set(sw, new Map());
    const m = bySwatch.get(sw)!;
    if (!m.has(r.lighting)) m.set(r.lighting, []);
    m.get(r.lighting)!.push(lab);
  }
  const diffs: number[] = [];
  for (const m of bySwatch.values()) {
    const means = [...m.values()].map((labs) => [0, 1, 2].map((i) => labs.reduce((s, l) => s + l[i], 0) / labs.length) as Lab);
    for (let i = 0; i < means.length; i++) for (let j = i + 1; j < means.length; j++) diffs.push(deltaE00(means[i], means[j]));
  }
  return median(diffs);
}

export function analyse(rows: StudyRow[], panel: PanelReading[] = []): Metrics {
  const decided = rows.filter((r) => r.pred_outcome !== "INCONCLUSIVE");
  const correct = decided.filter((r) => r.pred_outcome === r.true_outcome).length;
  const good = rows.filter((r) => r.quality_band === "GOOD");
  const confusion: Metrics["confusion"] = {};
  for (const t of LABELS.slice(0, 2)) {
    confusion[t] = {};
    for (const p of LABELS) confusion[t][p] = 0;
  }
  for (const r of rows) {
    confusion[r.true_outcome] ??= Object.fromEntries(LABELS.map((l) => [l, 0]));
    confusion[r.true_outcome][r.pred_outcome] = (confusion[r.true_outcome][r.pred_outcome] ?? 0) + 1;
  }

  const lightings = [...new Set(rows.map((r) => r.lighting))];
  const per_lighting: Metrics["per_lighting"] = {};
  for (const l of lightings) {
    const lr = rows.filter((r) => r.lighting === l);
    const ld = lr.filter((r) => r.pred_outcome !== "INCONCLUSIVE");
    per_lighting[l] = {
      n: lr.length,
      accuracy: ld.length ? ld.filter((r) => r.pred_outcome === r.true_outcome).length / ld.length : null,
      inconclusive: lr.length ? (lr.length - ld.length) / lr.length : 0,
    };
  }

  const truthById = new Map(rows.map((r) => [r.study_id, r.true_outcome]));
  const byRater = new Map<string, PanelReading[]>();
  for (const p of panel) {
    if (!truthById.has(p.study_id)) continue;
    if (!byRater.has(p.rater)) byRater.set(p.rater, []);
    byRater.get(p.rater)!.push(p);
  }
  const kappas: Record<string, number> = {};
  for (const [rater, readings] of byRater) {
    const k = cohensKappa(readings.map((p) => truthById.get(p.study_id)!), readings.map((p) => p.label));
    if (k !== null) kappas[rater] = k;
  }
  const kv = Object.values(kappas);

  const labOf = (L: number | null, a: number | null, b: number | null): Lab | null => (L === null || a === null || b === null ? null : [L, a, b]);

  return {
    n: rows.length,
    swatches: new Set(rows.map((r) => r.true_class)).size,
    lightings,
    devices: [...new Set(rows.map((r) => r.device))],
    m1_accuracy: decided.length ? correct / decided.length : null,
    m1_decided: decided.length,
    m2_inconclusive_good: good.length ? good.filter((r) => r.pred_outcome === "INCONCLUSIVE").length / good.length : null,
    m2_good_n: good.length,
    inconclusive_rate_all: rows.length ? (rows.length - decided.length) / rows.length : 0,
    m3_calibrated_median: lightingInvariance(rows, (r) => labOf(r.cal_L, r.cal_a, r.cal_b)),
    m3_raw_median: lightingInvariance(rows, (r) => labOf(r.raw_L, r.raw_a, r.raw_b)),
    m4_kappa_app: cohensKappa(rows.map((r) => r.true_outcome), rows.map((r) => r.pred_outcome)),
    m4_kappa_panel_mean: kv.length ? kv.reduce((s, k) => s + k, 0) / kv.length : null,
    m4_kappa_panel_by_rater: kappas,
    confusion,
    per_lighting,
  };
}

export const TARGETS = { m1: 0.95, m2: 0.1, m3: 3.0, m4: 0.9 };
