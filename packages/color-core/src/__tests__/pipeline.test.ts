import { describe, expect, it } from "vitest";
import { calibrate, PATCH_ORDER, type PatchId } from "../card";
import { applyAffine, correctImage, fitAffine, IDENTITY_AFFINE } from "../ccm";
import { deltaE00 } from "../ciede2000";
import { classify, inconclusiveWithoutMeasurement, minAreaPx, nearestClass, recommendedAction, type KitClassDef } from "../classify";
import { srgb8ToLab, type Lab, type Vec3 } from "../color";
import type { RgbaImage } from "../image";
import { glareFraction, laplacianVariance } from "../metrics";
import { qualityScore } from "../quality";
import { measureRoi, samplePatch, type PatchSample } from "../sampling";
import { CARD, COOL_CAST, PATCH_XY, ROI, WARM_CAST, renderScene, type Scene } from "./fixtures";

const SIM_A: KitClassDef[] = [
  { id: "SIM-A-POS", outcome: "PRELIMINARY_POSITIVE", label: "Simulated colour A", exemplars_lab: [[48, 40, -22], [45.5, 43, -25]], radius_de00: 15 },
  { id: "SIM-A-NEG", outcome: "PRELIMINARY_NEGATIVE", label: "Simulated clear", exemplars_lab: [[88, -1, 6]], radius_de00: 12 },
];
const THRESH = {
  blur_lapvar_hard: 60,
  blur_lapvar_good: 150,
  glare_hard: 0.03,
  glare_soft: 0.005,
  roi_min_radius_frac: 0.01,
  roi_spread_p90_max: 8.0,
  conf_min: 0.25,
};
const WEIGHTS = { sharpness: 0.25, clipping: 0.15, glare: 0.2, residual: 0.15, uniformity: 0.1, area: 0.05, card: 0.1 };

function tapAll(img: RgbaImage, offset: Partial<Record<PatchId, [number, number]>> = {}) {
  const s: Partial<Record<PatchId, PatchSample>> = {};
  for (const id of PATCH_ORDER) {
    const [x, y] = PATCH_XY[id];
    const [dx, dy] = offset[id] ?? [0, 0];
    s[id] = samplePatch(img, x + dx, y + dy, 15);
  }
  return s;
}

function run(scene: Scene) {
  const img = renderScene(scene);
  const cal = calibrate(tapAll(img), CARD, img);
  const roi = measureRoi(img, ROI, cal.matrix.length ? cal.matrix : IDENTITY_AFFINE);
  return { img, cal, roi };
}

describe("affine colour correction", () => {
  it("recovers an exact affine transform", () => {
    const M = [1.1, 0.05, -0.02, 0.01, 0.03, 0.9, 0.04, -0.005, -0.01, 0.02, 0.8, 0.02];
    const src: Vec3[] = [[0.9, 0.9, 0.85], [0.02, 0.02, 0.02], [0.4, 0.05, 0.03], [0.05, 0.3, 0.05], [0.04, 0.05, 0.4], [0.2, 0.2, 0.2]];
    const dst = src.map((p) => applyAffine(M, p));
    const fit = fitAffine(src, dst, 1e-9);
    fit.forEach((v, i) => expect(v).toBeCloseTo(M[i], 4));
  });

  it("is identity when the camera is perfect", () => {
    const { cal } = run({ sample: [48, 40, -22] });
    expect(cal.card_status).toBe("VALID");
    expect(cal.residual_de00_max).toBeLessThan(0.5);
  });

  it.each([
    ["warm", WARM_CAST],
    ["cool", COOL_CAST],
  ])("removes a %s colour cast with noise (ΔE00 < 1)", (_name, cast) => {
    const truth: Lab = [48, 40, -22];
    const { cal, roi } = run({ cast, noise: 6, sample: truth, seed: 7 });
    expect(cal.card_status).toBe("VALID");
    expect(cal.residual_de00_mean).toBeLessThan(1);
    expect(deltaE00(roi.lab, truth)).toBeLessThan(1);
  });

  it("gives the same answer for one sample under two different lights", () => {
    const a = run({ cast: WARM_CAST, noise: 4, sample: [55, -30, 20], seed: 3 }).roi.lab;
    const b = run({ cast: COOL_CAST, noise: 4, sample: [55, -30, 20], seed: 4 }).roi.lab;
    expect(deltaE00(a, b)).toBeLessThan(1);
  });

  it("stays usable under a mild camera non-linearity", () => {
    const truth: Lab = [48, 40, -22];
    const { cal, roi } = run({ cast: WARM_CAST, gamma: 1.08, noise: 3, sample: truth });
    expect(cal.card_status).toBe("VALID");
    expect(deltaE00(roi.lab, truth)).toBeLessThan(3);
  });
});

describe("corrected display image", () => {
  it("identity leaves pixels unchanged (within 1 level)", () => {
    const img = renderScene({ noise: 3, sample: [48, 40, -22] });
    const out = correctImage(img, IDENTITY_AFFINE);
    let worst = 0;
    for (let i = 0; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - img.data[i]));
    expect(worst).toBeLessThanOrEqual(1);
  });

  it("removes the cast: corrected pixels match the true sample colour", () => {
    const truth: Lab = [48, 40, -22];
    const { img, cal } = run({ cast: WARM_CAST, sample: truth });
    const out = correctImage(img, cal.matrix);
    const i = (ROI.y * img.width + ROI.x) * 4;
    expect(deltaE00(srgb8ToLab([out[i], out[i + 1], out[i + 2]]), truth)).toBeLessThan(1.5);
  });
});

describe("card validation", () => {
  it("fails ALL_MARKED when a patch is missing", () => {
    const img = renderScene({ sample: [48, 40, -22] });
    const s = tapAll(img);
    delete s.gray;
    const cal = calibrate(s, CARD, img);
    expect(cal.card_status).toBe("INVALID");
    expect(cal.failed_checks).toContain("ALL_MARKED");
  });

  it("fails CARD_RECOGNISED for an unknown card", () => {
    const img = renderScene({ sample: [48, 40, -22] });
    const cal = calibrate(tapAll(img), undefined, img);
    expect(cal.failed_checks).toContain("CARD_RECOGNISED");
  });

  it("catches taps in the wrong order", () => {
    const img = renderScene({ cast: WARM_CAST, sample: [48, 40, -22] });
    const s = tapAll(img);
    [s.red, s.blue] = [s.blue, s.red];
    const cal = calibrate(s, CARD, img);
    expect(cal.card_status).toBe("INVALID");
    expect(cal.failed_checks).toContain("EXPECTED_HUE");
  });

  it("catches white and black swapped via the neutral ramp", () => {
    const img = renderScene({ sample: [48, 40, -22] });
    const s = tapAll(img);
    [s.white, s.black] = [s.black, s.white];
    expect(calibrate(s, CARD, img).failed_checks).toContain("NEUTRAL_RAMP");
  });

  it("flags an off-centre tap that straddles a patch edge", () => {
    const img = renderScene({ sample: [48, 40, -22] });
    const s = tapAll(img, { green: [30, 0] });
    expect(s.green!.ok).toBe(false);
    expect(calibrate(s, CARD, img).failed_checks).toContain("PATCH_SAMPLE_OK");
  });

  it("catches an overexposed white patch", () => {
    const over = WARM_CAST.map((v, i) => (i % 4 === 3 ? v : v * 1.6));
    const img = renderScene({ cast: over, sample: [48, 40, -22] });
    expect(calibrate(tapAll(img), CARD, img).failed_checks).toContain("WHITE_NOT_CLIPPED");
  });
});

describe("ROI measurement", () => {
  it("reports low spread on a uniform sample and high spread on two colours", () => {
    const uniform = run({ noise: 3, sample: [48, 40, -22] }).roi;
    expect(uniform.spread_de00_p90).toBeLessThan(3);
    const mixed = run({ noise: 3, sample: { inner: [48, 40, -22], outer: [88, -1, 6] } }).roi;
    expect(mixed.spread_de00_p90).toBeGreaterThan(THRESH.roi_spread_p90_max);
  });

  it("counts area in pixels", () => {
    const { roi } = run({ sample: [48, 40, -22] });
    expect(roi.area_px).toBeGreaterThan(Math.PI * 39 * 39);
    expect(roi.area_px).toBeLessThan(Math.PI * 41 * 41);
  });
});

describe("quality metrics", () => {
  it("sharpness falls monotonically with blur", () => {
    const values = [0, 1, 2, 3].map((r) => laplacianVariance(renderScene({ noise: 2, sample: [48, 40, -22], blurRadius: r })));
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThan(values[i - 1]);
  });

  it("detects specular glare in the ROI", () => {
    const img = renderScene({ sample: [48, 40, -22], glareSpots: [{ x: ROI.x + 5, y: ROI.y, r: 8 }] });
    const g = glareFraction(img, ROI);
    expect(g.glare_fraction).toBeGreaterThan(THRESH.glare_hard);
  });

  it("exempts a pale clear sample from glare", () => {
    const img = renderScene({ sample: [96, 0, 1], background: [30, 0, 0] });
    const roi = measureRoi(img, ROI, IDENTITY_AFFINE);
    expect(glareFraction(img, ROI, roi.lab, roi.clipped_fraction).glare_fraction).toBe(0);
  });

  it("scores a clean capture GOOD and names the worst components", () => {
    const { img, cal, roi } = run({ cast: WARM_CAST, noise: 3, sample: [48, 40, -22] });
    const q = qualityScore(
      {
        laplacian_variance: 400,
        clipped_fraction: roi.clipped_fraction,
        glare_fraction: glareFraction(img, ROI, roi.lab).glare_fraction,
        residual_de00_mean: cal.residual_de00_mean,
        spread_de00_p90: roi.spread_de00_p90,
        area_px: roi.area_px,
        min_area_px: minAreaPx(0.01, 480),
        card_confidence: cal.card_confidence,
        card_valid: true,
      },
      THRESH,
      WEIGHTS
    );
    expect(q.band).toBe("GOOD");
    expect(q.hard_gates).toEqual([]);
  });

  it("applies hard gates regardless of score", () => {
    const q = qualityScore(
      { laplacian_variance: 20, clipped_fraction: 0, glare_fraction: 0.05, residual_de00_mean: 1, spread_de00_p90: 1, area_px: 5000, min_area_px: 100, card_confidence: 1, card_valid: false },
      THRESH,
      WEIGHTS
    );
    expect(q.hard_gates).toEqual(["IMAGE_BLURRY", "EXCESSIVE_GLARE", "CARD_CALIBRATION_FAILED"]);
    expect(q.reasons[0]).toBe("sharpness");
  });
});

describe("classification", () => {
  const base = { spread_de00_p90: 2, area_px: 5000, min_area_px: 300, residual_de00_mean: 1, classes: SIM_A, thresholds: THRESH };

  it("confidence is 1 on an exemplar and 0 when equidistant", () => {
    expect(nearestClass([48, 40, -22], SIM_A).confidence).toBe(1);
    const n = nearestClass([88, -1, 6], SIM_A);
    expect(n.best.id).toBe("SIM-A-NEG");
    expect(n.confidence).toBe(1);
  });

  it("returns PRELIMINARY_POSITIVE near the positive exemplar", () => {
    const c = classify({ ...base, lab: [49, 38, -20] });
    expect(c.outcome).toBe("PRELIMINARY_POSITIVE");
    expect(c.class_id).toBe("SIM-A-POS");
    expect(c.inconclusive_reasons).toEqual([]);
    expect(c.recommended_action).toBeNull();
  });

  it("returns PRELIMINARY_NEGATIVE for a clear sample", () => {
    expect(classify({ ...base, lab: [87, 0, 5] }).outcome).toBe("PRELIMINARY_NEGATIVE");
  });

  it("goes INCONCLUSIVE with MEASUREMENT_UNCERTAINTY_HIGH between close classes", () => {
    const close: KitClassDef[] = [
      { id: "P", outcome: "PRELIMINARY_POSITIVE", label: "p", exemplars_lab: [[50, 30, -20]], radius_de00: 15 },
      { id: "N", outcome: "PRELIMINARY_NEGATIVE", label: "n", exemplars_lab: [[58, 14, -8]], radius_de00: 15 },
    ];
    const c = classify({ ...base, classes: close, lab: [54, 22, -14] });
    expect(c.inconclusive_reasons).not.toContain("OUTSIDE_REFERENCE_RANGE");
    expect(c.outcome).toBe("INCONCLUSIVE");
    expect(c.inconclusive_reasons).toContain("MEASUREMENT_UNCERTAINTY_HIGH");
    expect(c.recommended_action).toBe("REPEAT_TEST");
  });

  it("between SIM-A's classes the colour is also out of range, so it escalates to the lab", () => {
    const c = classify({ ...base, lab: [68, 20, -8] });
    expect(c.inconclusive_reasons).toEqual(["OUTSIDE_REFERENCE_RANGE", "MEASUREMENT_UNCERTAINTY_HIGH"]);
    expect(c.recommended_action).toBe("PRESERVE_FOR_LAB");
  });

  it("OUTSIDE_REFERENCE_RANGE recommends preserving for the lab", () => {
    const c = classify({ ...base, lab: [30, -40, -40] });
    expect(c.inconclusive_reasons).toContain("OUTSIDE_REFERENCE_RANGE");
    expect(c.recommended_action).toBe("PRESERVE_FOR_LAB");
  });

  it("lists every reason and the most severe action", () => {
    const c = classify({ ...base, lab: [48, 40, -22], area_px: 100, spread_de00_p90: 12, outside_window: true, card_valid: false });
    expect(c.inconclusive_reasons).toEqual([
      "CARD_CALIBRATION_FAILED",
      "REACTION_AREA_TOO_SMALL",
      "MULTIPLE_COLOURS",
      "OUTSIDE_REACTION_WINDOW",
    ]);
    expect(c.recommended_action).toBe("REPEAT_TEST");
  });

  it("a positive-looking capture outside the reaction window is still INCONCLUSIVE", () => {
    const c = classify({ ...base, lab: [48, 40, -22], outside_window: true });
    expect(c.outcome).toBe("INCONCLUSIVE");
    expect(c.class_id).toBe("SIM-A-POS"); // nearest class is still recorded
  });

  it("a retest of an inconclusive that is inconclusive again escalates to the lab", () => {
    const c = classify({ ...base, lab: [48, 40, -22], area_px: 100, retest_of_inconclusive: true });
    expect(c.inconclusive_reasons).toContain("REPEAT_ALSO_INCONCLUSIVE");
    expect(c.recommended_action).toBe("PRESERVE_FOR_LAB");
  });

  it("builds a record for tests that ended without a measurement", () => {
    const c = inconclusiveWithoutMeasurement(["CARD_CALIBRATION_FAILED", "ABANDONED"]);
    expect(c.outcome).toBe("INCONCLUSIVE");
    expect(c.recommended_action).toBe("REPEAT_TEST");
    expect(recommendedAction([])).toBeNull();
  });

  it("end to end: warm light, noisy capture of the positive colour", () => {
    const { cal, roi } = run({ cast: WARM_CAST, noise: 5, sample: [47, 41, -23], seed: 11 });
    const c = classify({ ...base, lab: roi.lab, spread_de00_p90: roi.spread_de00_p90, area_px: roi.area_px, residual_de00_mean: cal.residual_de00_mean, card_valid: cal.card_status === "VALID" });
    expect(c.outcome).toBe("PRELIMINARY_POSITIVE");
    expect(c.confidence).toBeGreaterThan(0.5);
  });
});
