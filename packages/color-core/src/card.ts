import { labToLinear, linearToLab, luminance8, srgb8ToLinear, type Lab, type Vec3 } from "./color";
import { applyAffine, DEFAULT_RIDGE, fitAffine, type AffineMatrix } from "./ccm";
import { deltaE00 } from "./ciede2000";
import type { PatchSample } from "./sampling";

/** Card calibration and validation (ARCHITECTURE §6.1, §6.2). */

export const PATCH_ORDER = ["white", "black", "red", "green", "blue", "gray"] as const;
export type PatchId = (typeof PATCH_ORDER)[number];

export interface CardReference {
  patches: { id: PatchId; lab: Lab }[];
  /** Printed-card geometry; see geometry.ts. */
  layout?: import("./geometry").CardLayout;
  checks: {
    residual_mean_max: number;
    residual_max_max: number;
    neutral_ab_max: number;
    clip_frac_max: number;
    /** 8-bit margin by which the dominant channel must lead. Default 10. */
    hue_margin?: number;
    /** Relative-luminance margin between neutral steps. Default 0.02. */
    ramp_margin?: number;
  };
}

export type CardCheckId =
  | "ALL_MARKED"
  | "PATCH_SAMPLE_OK"
  | "EXPECTED_HUE"
  | "WHITE_NOT_CLIPPED"
  | "BLACK_NOT_CRUSHED"
  | "NEUTRAL_RAMP"
  | "NEUTRAL_CAST"
  | "RESIDUAL_MEAN"
  | "RESIDUAL_MAX"
  | "CARD_RECOGNISED";

export interface CardCheck {
  id: CardCheckId;
  pass: boolean;
  /** Headroom in [0, 1] used for the quality score: 1 = far inside the limit. */
  margin: number;
  detail: string;
}

export interface Calibration {
  model: "affine3x4";
  matrix: AffineMatrix;
  residuals_de00: Record<string, number>;
  residual_de00_mean: number;
  residual_de00_max: number;
  card_status: "VALID" | "INVALID";
  failed_checks: CardCheckId[];
  checks: CardCheck[];
  /** Fraction of checks passed, weighted by margin; feeds the quality score. */
  card_confidence: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function lead(rgb: Vec3, ch: 0 | 1 | 2): number {
  const others = [0, 1, 2].filter((c) => c !== ch).map((c) => rgb[c]);
  return rgb[ch] - Math.max(...others);
}

/** Fit the colour correction from sampled patches and run every card check.
 * `samples` is keyed by patch id; missing patches fail ALL_MARKED.
 * `reference` undefined means the card version is not in the Reference DB. */
export function calibrate(
  samples: Partial<Record<PatchId, PatchSample>>,
  reference: CardReference | undefined,
  image: { width: number; height: number },
  opts: { minSeparationPx?: number; ridge?: number } = {}
): Calibration {
  const checks: CardCheck[] = [];
  const add = (id: CardCheckId, pass: boolean, margin: number, detail: string) =>
    checks.push({ id, pass, margin: pass ? clamp01(margin) : 0, detail });

  add("CARD_RECOGNISED", !!reference, 1, reference ? "card version found in Reference DB" : "unknown card version");

  const present = PATCH_ORDER.filter((id) => samples[id]);
  const minSep = opts.minSeparationPx ?? 10;
  const inside = present.every((id) => {
    const [x, y] = samples[id]!.xy;
    return x >= 0 && y >= 0 && x < image.width && y < image.height;
  });
  let overlapping = false;
  for (let i = 0; i < present.length; i++)
    for (let j = i + 1; j < present.length; j++) {
      const a = samples[present[i]]!.xy;
      const b = samples[present[j]]!.xy;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < minSep) overlapping = true;
    }
  const allMarked = present.length === PATCH_ORDER.length && inside && !overlapping;
  add(
    "ALL_MARKED",
    allMarked,
    1,
    allMarked
      ? "6 patches marked"
      : `${present.length}/6 marked${inside ? "" : ", tap outside image"}${overlapping ? ", taps overlap" : ""}`
  );

  if (!allMarked || !reference) {
    return {
      model: "affine3x4",
      matrix: [],
      residuals_de00: {},
      residual_de00_mean: NaN,
      residual_de00_max: NaN,
      card_status: "INVALID",
      failed_checks: checks.filter((c) => !c.pass).map((c) => c.id),
      checks,
      card_confidence: 0,
    };
  }

  const s = (id: PatchId) => samples[id]!;
  const c = reference.checks;
  const hueMargin = c.hue_margin ?? 10;
  const rampMargin = c.ramp_margin ?? 0.02;

  const badTaps = PATCH_ORDER.filter((id) => !s(id).ok);
  add("PATCH_SAMPLE_OK", badTaps.length === 0, 1, badTaps.length ? `tap nearer the centre: ${badTaps.join(", ")}` : "all taps uniform");

  const leads = { red: lead(s("red").rgb, 0), green: lead(s("green").rgb, 1), blue: lead(s("blue").rgb, 2) };
  const minLead = Math.min(leads.red, leads.green, leads.blue);
  add(
    "EXPECTED_HUE",
    minLead >= hueMargin,
    minLead / (hueMargin * 4),
    `channel lead R ${leads.red.toFixed(0)}, G ${leads.green.toFixed(0)}, B ${leads.blue.toFixed(0)} (min ${hueMargin})`
  );

  const wc = s("white").clip_high;
  add("WHITE_NOT_CLIPPED", wc <= c.clip_frac_max, 1 - wc / c.clip_frac_max, `${(wc * 100).toFixed(1)}% of white at 255`);
  const bc = s("black").clip_low;
  add("BLACK_NOT_CRUSHED", bc <= c.clip_frac_max, 1 - bc / c.clip_frac_max, `${(bc * 100).toFixed(1)}% of black at 0`);

  const yb = luminance8(s("black").rgb);
  const yg = luminance8(s("gray").rgb);
  const yw = luminance8(s("white").rgb);
  const rampGap = Math.min(yg - yb, yw - yg);
  add(
    "NEUTRAL_RAMP",
    rampGap >= rampMargin,
    rampGap / (rampMargin * 5),
    `luminance black ${yb.toFixed(3)} < gray ${yg.toFixed(3)} < white ${yw.toFixed(3)}`
  );

  const measured = PATCH_ORDER.map((id) => srgb8ToLinear(s(id).rgb));
  const refLab = new Map(reference.patches.map((p) => [p.id, p.lab]));
  const target = PATCH_ORDER.map((id) => labToLinear(refLab.get(id)!));
  const matrix = fitAffine(measured, target, opts.ridge ?? DEFAULT_RIDGE);

  const residuals: Record<string, number> = {};
  const corrected: Record<string, Lab> = {};
  PATCH_ORDER.forEach((id, k) => {
    corrected[id] = linearToLab(applyAffine(matrix, measured[k]));
    residuals[id] = deltaE00(corrected[id], refLab.get(id)!);
  });
  const vals = Object.values(residuals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const max = Math.max(...vals);

  const cast = Math.max(...(["white", "gray", "black"] as const).flatMap((id) => [Math.abs(corrected[id][1]), Math.abs(corrected[id][2])]));
  add("NEUTRAL_CAST", cast < c.neutral_ab_max, 1 - cast / c.neutral_ab_max, `max |a*|,|b*| on neutrals ${cast.toFixed(2)}`);
  add("RESIDUAL_MEAN", mean <= c.residual_mean_max, 1 - mean / c.residual_mean_max, `mean ΔE00 ${mean.toFixed(2)} (max ${c.residual_mean_max})`);
  add("RESIDUAL_MAX", max <= c.residual_max_max, 1 - max / c.residual_max_max, `max ΔE00 ${max.toFixed(2)} (max ${c.residual_max_max})`);

  const failed = checks.filter((k) => !k.pass).map((k) => k.id);
  const confidence = checks.reduce((a, k) => a + (k.pass ? 0.5 + 0.5 * k.margin : 0), 0) / checks.length;

  return {
    model: "affine3x4",
    matrix,
    residuals_de00: residuals,
    residual_de00_mean: mean,
    residual_de00_max: max,
    card_status: failed.length ? "INVALID" : "VALID",
    failed_checks: failed,
    checks,
    card_confidence: confidence,
  };
}
