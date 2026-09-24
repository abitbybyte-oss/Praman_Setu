/** Capture quality score (ARCHITECTURE §6.5).
 *
 * score = round(100 · Σ wᵢ·sᵢ), each sᵢ a clamped linear ramp between a "bad"
 * and a "good" threshold. Hard gates override the score. */

export type QualityComponent = "sharpness" | "clipping" | "glare" | "residual" | "uniformity" | "area" | "card";
export type QualityBand = "GOOD" | "FAIR" | "POOR";
export type HardGate = "IMAGE_BLURRY" | "EXCESSIVE_GLARE" | "CARD_CALIBRATION_FAILED";

export interface QualityInputs {
  laplacian_variance: number;
  clipped_fraction: number;
  glare_fraction: number;
  residual_de00_mean: number;
  spread_de00_p90: number;
  area_px: number;
  min_area_px: number;
  card_confidence: number;
  card_valid: boolean;
}

export interface QualityThresholds {
  blur_lapvar_hard: number;
  blur_lapvar_good: number;
  glare_hard: number;
  glare_soft: number;
  roi_spread_p90_max: number;
  residual_mean_max?: number;
  clip_bad?: number;
  clip_good?: number;
}

export interface QualityResult {
  score: number;
  band: QualityBand;
  components: Record<QualityComponent, number>;
  /** Up to 3 components with the largest weighted shortfall, worst first. */
  reasons: QualityComponent[];
  hard_gates: HardGate[];
}

/** Linear ramp: 0 at `bad`, 1 at `good`, clamped. Works in either direction. */
export function ramp(value: number, bad: number, good: number): number {
  if (!Number.isFinite(value)) return 0;
  const t = (value - bad) / (good - bad);
  return Math.min(1, Math.max(0, t));
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function qualityScore(
  q: QualityInputs,
  t: QualityThresholds,
  weights: Record<QualityComponent, number>
): QualityResult {
  const components: Record<QualityComponent, number> = {
    sharpness: ramp(q.laplacian_variance, t.blur_lapvar_hard, t.blur_lapvar_good),
    clipping: ramp(q.clipped_fraction, t.clip_bad ?? 0.05, t.clip_good ?? 0.005),
    glare: ramp(q.glare_fraction, t.glare_hard, t.glare_soft),
    residual: ramp(q.residual_de00_mean, t.residual_mean_max ?? 3.0, 1.0),
    uniformity: ramp(q.spread_de00_p90, t.roi_spread_p90_max, 2.0),
    area: ramp(q.area_px, 0.5 * q.min_area_px, 2 * q.min_area_px),
    card: Math.min(1, Math.max(0, q.card_confidence)),
  };
  for (const k of Object.keys(components) as QualityComponent[]) components[k] = round2(components[k]);

  const keys = Object.keys(components) as QualityComponent[];
  const total = keys.reduce((a, k) => a + (weights[k] ?? 0), 0) || 1;
  const score = Math.round((100 * keys.reduce((a, k) => a + (weights[k] ?? 0) * components[k], 0)) / total);
  const band: QualityBand = score >= 80 ? "GOOD" : score >= 60 ? "FAIR" : "POOR";

  const reasons = keys
    .map((k) => ({ k, short: (weights[k] ?? 0) * (1 - components[k]) }))
    .filter((r) => r.short > 0.005)
    .sort((a, b) => b.short - a.short || keys.indexOf(a.k) - keys.indexOf(b.k))
    .slice(0, 3)
    .map((r) => r.k);

  const hard_gates: HardGate[] = [];
  if (q.laplacian_variance < t.blur_lapvar_hard) hard_gates.push("IMAGE_BLURRY");
  if (q.glare_fraction >= t.glare_hard) hard_gates.push("EXCESSIVE_GLARE");
  if (!q.card_valid) hard_gates.push("CARD_CALIBRATION_FAILED");

  return { score, band, components, reasons, hard_gates };
}
