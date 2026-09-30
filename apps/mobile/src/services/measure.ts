import {
  calibrate,
  classify,
  CORNER_ORDER,
  deltaE00,
  glareFraction,
  laplacianVariance,
  measureRoi,
  minAreaPx,
  qualityScore,
  sampleCard,
  snapMarker,
  type Calibration,
  type CardSampling,
  type Circle,
  type Classification,
  type CornerId,
  type GlareResult,
  type KitClassDef,
  type Point,
  type QualityResult,
  type QualityThresholds,
  type RgbaImage,
  type RoiMeasurement,
} from '@fdtc/color-core';

import { cardReference, DEFAULT_CARD, kit, qualityWeights, thresholds } from './refdb';

/** The measurement pipeline: color-core rules + Reference DB thresholds.
 * No UI and no storage here, so every step is plain data in and out. */

/** CAP-03: blur hard gate, on the central region of the frame. */
export function blurCheck(img: RgbaImage): { laplacian_variance: number; blurry: boolean } {
  const lv = laplacianVariance(img, { x: img.width * 0.15, y: img.height * 0.15, w: img.width * 0.7, h: img.height * 0.7 });
  return { laplacian_variance: lv, blurry: lv < thresholds().blur_lapvar_hard };
}

/** Snap radius for a fingertip tap on the working copy. */
export function snapRadius(img: RgbaImage): number {
  return Math.round(Math.max(img.width, img.height) * 0.035);
}

export function snapCorner(img: RgbaImage, tap: Point) {
  return snapMarker(img, tap, snapRadius(img));
}

export interface CardResult {
  sampling: CardSampling;
  calibration: Calibration;
  /** Sharpness over the card, used by the quality score. */
  laplacian_variance: number;
}

export function calibrateCard(img: RgbaImage, taps: Record<CornerId, Point>): CardResult {
  const ref = cardReference(DEFAULT_CARD);
  if (!ref?.layout) throw new Error(`${DEFAULT_CARD} is missing from the Reference DB`);
  const sampling = sampleCard(img, ref.layout, taps);
  const calibration = sampling.corners.ok
    ? calibrate(sampling.samples, ref, img)
    : calibrate({}, ref, img); // corners rejected: every check fails with ALL_MARKED
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // TEMP diagnostics for printed-card calibration; remove after tuning.
    console.log('[CARD] samples', JSON.stringify(Object.fromEntries(Object.entries(sampling.samples).map(([id, p]) => [id, { rgb: p.rgb, ok: p.ok, clip_high: p.clip_high }]))));
    console.log('[CARD] residuals', JSON.stringify(calibration.residuals_de00));
    console.log('[CARD] checks', JSON.stringify(calibration.checks.map((c) => `${c.pass ? 'ok ' : 'FAIL'} ${c.id}: ${c.detail}`)));
  }
  const xs = CORNER_ORDER.map((c) => taps[c][0]);
  const ys = CORNER_ORDER.map((c) => taps[c][1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const laplacian_variance = laplacianVariance(img, { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
  return { sampling, calibration, laplacian_variance };
}

export function defaultRoiRadius(img: RgbaImage): number {
  return Math.round(Math.max(img.width, img.height) * 0.03);
}

export interface SampleResult {
  roi: RoiMeasurement;
  glare: GlareResult;
  quality: QualityResult;
  classification: Classification;
  min_area_px: number;
  glareHardGate: boolean;
}

export function measureSample(
  img: RgbaImage,
  circle: Circle,
  card: CardResult,
  kitType: string,
  opts: { outsideWindow?: boolean; retestOfInconclusive?: boolean } = {}
): SampleResult {
  const t = thresholds();
  const roi = measureRoi(img, circle, card.calibration.matrix, card.calibration.tone_gamma);
  const glare = glareFraction(img, circle, roi.lab, roi.clipped_fraction);
  const min_area_px = minAreaPx(t.roi_min_radius_frac, Math.max(img.width, img.height));
  const quality = qualityScore(
    {
      laplacian_variance: card.laplacian_variance,
      clipped_fraction: roi.clipped_fraction,
      glare_fraction: glare.glare_fraction,
      residual_de00_mean: card.calibration.residual_de00_mean,
      spread_de00_p90: roi.spread_de00_p90,
      area_px: roi.area_px,
      min_area_px,
      card_confidence: card.calibration.card_confidence,
      card_valid: card.calibration.card_status === 'VALID',
    },
    t as unknown as QualityThresholds,
    qualityWeights() as never
  );
  const classification = classify({
    lab: roi.lab,
    spread_de00_p90: roi.spread_de00_p90,
    area_px: roi.area_px,
    min_area_px,
    residual_de00_mean: card.calibration.residual_de00_mean,
    classes: kit(kitType).classes as KitClassDef[],
    thresholds: { roi_spread_p90_max: t.roi_spread_p90_max, conf_min: t.conf_min },
    quality_band: quality.band,
    quality_reasons: quality.reasons,
    card_valid: card.calibration.card_status === 'VALID',
    outside_window: opts.outsideWindow,
    retest_of_inconclusive: opts.retestOfInconclusive,
  });
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // TEMP diagnostics for printed-card calibration; remove after tuning.
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const dists = (kit(kitType).classes as KitClassDef[]).map((c) => `${c.id} ${r1(Math.min(...c.exemplars_lab.map((e) => deltaE00(roi.lab, e))))} (max ${c.radius_de00})`);
    console.log('[ROI]', kitType, 'lab', roi.lab.map(r1), 'spread', r1(roi.spread_de00_p90), 'area', roi.area_px, '/', min_area_px, '| dist', dists.join(', '));
    console.log('[ROI] ->', classification.outcome, JSON.stringify(classification.inconclusive_reasons), 'quality', quality.score, quality.band, 'card', card.calibration.card_status);
  }
  return { roi, glare, quality, classification, min_area_px, glareHardGate: glare.glare_fraction >= t.glare_hard };
}

