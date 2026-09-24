import {
  calibrate,
  classify,
  CORNER_ORDER,
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
  const roi = measureRoi(img, circle, card.calibration.matrix);
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
  return { roi, glare, quality, classification, min_area_px, glareHardGate: glare.glare_fraction >= t.glare_hard };
}

/** Plain-language text for card checks (CAL-04 "failed checks listed"). */
export const CARD_CHECK_TEXT: Record<string, string> = {
  CARD_RECOGNISED: 'Card version not recognised',
  ALL_MARKED: 'Card corners not located — retap the four dots',
  PATCH_SAMPLE_OK: 'A colour patch is not uniform (shadow, glare or dirt)',
  EXPECTED_HUE: 'Patch colours are not where expected — wrong card or card upside down',
  WHITE_NOT_CLIPPED: 'White patch overexposed — too bright',
  BLACK_NOT_CRUSHED: 'Black patch underexposed — too dark',
  NEUTRAL_RAMP: 'White / gray / black patches out of order',
  NEUTRAL_CAST: 'Strong colour cast remains after correction',
  RESIDUAL_MEAN: 'Colour correction error too high — uneven lighting?',
  RESIDUAL_MAX: 'One patch corrects badly — shadow or glare on the card?',
};

export const CORNER_TEXT: Record<string, string> = {
  NOT_CONVEX: 'Corner taps cross over',
  WRONG_ORDER: 'Corners tapped in the wrong order',
  TOO_SMALL: 'Card too small in the photo — move closer',
  BAD_ASPECT: 'Corner taps do not match the card shape',
};
