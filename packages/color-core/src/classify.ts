import type { Lab } from "./color";
import { deltaE00 } from "./ciede2000";
import type { HardGate, QualityBand, QualityComponent } from "./quality";

/** Nearest-class classification with honest uncertainty (ARCHITECTURE §6.4, PRD §8.2). */

export type Outcome = "PRELIMINARY_POSITIVE" | "PRELIMINARY_NEGATIVE" | "INCONCLUSIVE";

export type InconclusiveReason =
  | "IMAGE_BLURRY"
  | "POOR_LIGHTING"
  | "EXCESSIVE_GLARE"
  | "REACTION_AREA_TOO_SMALL"
  | "CARD_CALIBRATION_FAILED"
  | "MULTIPLE_COLOURS"
  | "MEASUREMENT_UNCERTAINTY_HIGH"
  | "OUTSIDE_REACTION_WINDOW"
  | "ABANDONED"
  | "OUTSIDE_REFERENCE_RANGE"
  | "REPEAT_ALSO_INCONCLUSIVE";

export type RecommendedAction = "RETAKE_PHOTO" | "REPEAT_TEST" | "PRESERVE_FOR_LAB";

export const REASON_ACTION: Record<InconclusiveReason, RecommendedAction> = {
  IMAGE_BLURRY: "RETAKE_PHOTO",
  POOR_LIGHTING: "RETAKE_PHOTO",
  EXCESSIVE_GLARE: "RETAKE_PHOTO",
  REACTION_AREA_TOO_SMALL: "RETAKE_PHOTO",
  CARD_CALIBRATION_FAILED: "RETAKE_PHOTO",
  MULTIPLE_COLOURS: "REPEAT_TEST",
  MEASUREMENT_UNCERTAINTY_HIGH: "REPEAT_TEST",
  OUTSIDE_REACTION_WINDOW: "REPEAT_TEST",
  ABANDONED: "REPEAT_TEST",
  OUTSIDE_REFERENCE_RANGE: "PRESERVE_FOR_LAB",
  REPEAT_ALSO_INCONCLUSIVE: "PRESERVE_FOR_LAB",
};

const ACTION_SEVERITY: Record<RecommendedAction, number> = { RETAKE_PHOTO: 1, REPEAT_TEST: 2, PRESERVE_FOR_LAB: 3 };

/** The most severe action implied by any reason: lab > repeat > retake. */
export function recommendedAction(reasons: InconclusiveReason[]): RecommendedAction | null {
  let best: RecommendedAction | null = null;
  for (const r of reasons) {
    const a = REASON_ACTION[r];
    if (!best || ACTION_SEVERITY[a] > ACTION_SEVERITY[best]) best = a;
  }
  return best;
}

/** Map the dominant quality shortfall to an officer-facing reason. */
const QUALITY_REASON: Record<QualityComponent, InconclusiveReason> = {
  sharpness: "IMAGE_BLURRY",
  clipping: "POOR_LIGHTING",
  glare: "EXCESSIVE_GLARE",
  residual: "POOR_LIGHTING",
  uniformity: "MULTIPLE_COLOURS",
  area: "REACTION_AREA_TOO_SMALL",
  card: "CARD_CALIBRATION_FAILED",
};

export interface KitClassDef {
  id: string;
  outcome: "PRELIMINARY_POSITIVE" | "PRELIMINARY_NEGATIVE";
  label: string;
  exemplars_lab: Lab[];
  radius_de00: number;
}

export interface ClassifyInput {
  lab: Lab;
  spread_de00_p90: number;
  area_px: number;
  min_area_px: number;
  residual_de00_mean: number;
  classes: KitClassDef[];
  thresholds: { roi_spread_p90_max: number; conf_min: number };
  quality_band?: QualityBand;
  /** Dominant quality reason, used when the band is POOR. */
  quality_reasons?: QualityComponent[];
  card_valid?: boolean;
  /** Hard gate the officer chose to end on instead of retaking. */
  ended_on_hard_gate?: HardGate;
  outside_window?: boolean;
  abandoned?: boolean;
  retest_of_inconclusive?: boolean;
}

export interface Classification {
  algorithm: "nearest-class-de00/1";
  outcome: Outcome;
  class_id: string | null;
  class_label: string | null;
  d1_de00: number | null;
  d2_de00: number | null;
  confidence: number;
  uncertainty_de00: number;
  inconclusive_reasons: InconclusiveReason[];
  recommended_action: RecommendedAction | null;
}

function classDistance(lab: Lab, c: KitClassDef): number {
  return Math.min(...c.exemplars_lab.map((e) => deltaE00(lab, e)));
}

/** Pure colour-match part: nearest class, runner-up of a different outcome, margin ratio. */
export function nearestClass(lab: Lab, classes: KitClassDef[]) {
  if (classes.length === 0) throw new Error("kit profile has no classes");
  const scored = classes.map((c) => ({ c, d: classDistance(lab, c) })).sort((a, b) => a.d - b.d);
  const best = scored[0];
  const rival = scored.find((s) => s.c.outcome !== best.c.outcome);
  const d1 = best.d;
  const d2 = rival ? rival.d : null;
  const confidence = d2 === null ? 1 : d1 + d2 === 0 ? 0 : (d2 - d1) / (d2 + d1);
  return { best: best.c, d1, d2, confidence };
}

export function classify(input: ClassifyInput): Classification {
  const reasons: InconclusiveReason[] = [];
  const add = (r: InconclusiveReason) => {
    if (!reasons.includes(r)) reasons.push(r);
  };

  if (input.ended_on_hard_gate) add(input.ended_on_hard_gate);
  if (input.quality_band === "POOR") add(QUALITY_REASON[input.quality_reasons?.[0] ?? "residual"]);
  if (input.card_valid === false) add("CARD_CALIBRATION_FAILED");
  if (input.area_px < input.min_area_px) add("REACTION_AREA_TOO_SMALL");
  if (input.spread_de00_p90 > input.thresholds.roi_spread_p90_max) add("MULTIPLE_COLOURS");

  const { best, d1, d2, confidence } = nearestClass(input.lab, input.classes);
  const u = Math.sqrt(input.residual_de00_mean ** 2 + (input.spread_de00_p90 / 2) ** 2);

  if (d1 > best.radius_de00) add("OUTSIDE_REFERENCE_RANGE");
  if ((d2 !== null && d2 - d1 < 2 * u) || confidence < input.thresholds.conf_min) add("MEASUREMENT_UNCERTAINTY_HIGH");
  if (input.outside_window) add("OUTSIDE_REACTION_WINDOW");
  if (input.abandoned) add("ABANDONED");
  if (input.retest_of_inconclusive && reasons.length > 0) add("REPEAT_ALSO_INCONCLUSIVE");

  const inconclusive = reasons.length > 0;
  return {
    algorithm: "nearest-class-de00/1",
    outcome: inconclusive ? "INCONCLUSIVE" : best.outcome,
    class_id: best.id,
    class_label: best.label,
    d1_de00: d1,
    d2_de00: d2,
    confidence,
    uncertainty_de00: u,
    inconclusive_reasons: reasons,
    recommended_action: recommendedAction(reasons),
  };
}

/** Classification for a test that never reached ROI measurement (card invalid
 * and ended, hard gate ended, or abandoned). */
export function inconclusiveWithoutMeasurement(reasons: InconclusiveReason[]): Classification {
  const unique = [...new Set(reasons)];
  return {
    algorithm: "nearest-class-de00/1",
    outcome: "INCONCLUSIVE",
    class_id: null,
    class_label: null,
    d1_de00: null,
    d2_de00: null,
    confidence: 0,
    uncertainty_de00: 0,
    inconclusive_reasons: unique,
    recommended_action: recommendedAction(unique),
  };
}

/** Minimum ROI area from the Reference DB's roi_min_radius_frac and the
 * working-copy long side. */
export function minAreaPx(roiMinRadiusFrac: number, longSidePx: number): number {
  const r = roiMinRadiusFrac * longSidePx;
  return Math.PI * r * r;
}
