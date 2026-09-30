import { linearToLab, srgbToLinear, type Lab, type Vec3 } from "./color";
import { applyAffine, applyTone, type AffineMatrix } from "./ccm";
import { deltaE00 } from "./ciede2000";
import { channelValues, circleIndices, median, percentile, rectIndices, type Circle, type RgbaImage } from "./image";

/** Patch and ROI sampling (ARCHITECTURE §6.1). */

export interface PatchSample {
  xy: [number, number];
  /** Per-channel median, 8-bit sRGB. */
  rgb: Vec3;
  /** Largest per-channel median absolute deviation. */
  mad: number;
  /** Fraction of window pixels with any channel at 255. */
  clip_high: number;
  /** Fraction of window pixels with any channel at 0. */
  clip_low: number;
  /** Fraction of window pixels far (> 2·madMax) from the median in any channel. */
  outlier_fraction: number;
  /** False when the window straddles a patch edge ("tap nearer the centre"). */
  ok: boolean;
}

export const DEFAULT_PATCH_WINDOW = 15;
export const DEFAULT_PATCH_MAD_MAX = 8;
const MAX_OUTLIER_FRACTION = 0.1;

/** Default window: about 2% of the card width, at least 5 px, odd. */
export function patchWindowFor(cardWidthPx: number): number {
  const k = Math.max(5, Math.round(cardWidthPx * 0.02));
  return k % 2 ? k : k + 1;
}

export function samplePatch(
  img: RgbaImage,
  x: number,
  y: number,
  k: number = DEFAULT_PATCH_WINDOW,
  madMax: number = DEFAULT_PATCH_MAD_MAX
): PatchSample {
  const half = Math.floor(k / 2);
  const idx = rectIndices(img, { x: Math.round(x) - half, y: Math.round(y) - half, w: k, h: k });
  const rgb: number[] = [];
  let mad = 0;
  const far = new Uint8Array(idx.length);
  for (const ch of [0, 1, 2] as const) {
    const v = channelValues(img, idx, ch);
    const m = median(v);
    rgb.push(m);
    mad = Math.max(mad, median(v.map((x) => Math.abs(x - m))));
    // MAD alone misses a window split ~50/50 across an edge, so also count outliers.
    v.forEach((x, k) => {
      if (Math.abs(x - m) > 2 * madMax) far[k] = 1;
    });
  }
  const outliers = far.reduce((a, b) => a + b, 0) / Math.max(1, idx.length);
  let hi = 0;
  let lo = 0;
  for (const i of idx) {
    const r = img.data[i * 4];
    const g = img.data[i * 4 + 1];
    const b = img.data[i * 4 + 2];
    if (r === 255 || g === 255 || b === 255) hi++;
    if (r === 0 || g === 0 || b === 0) lo++;
  }
  const n = Math.max(1, idx.length);
  return {
    xy: [Math.round(x), Math.round(y)],
    rgb: rgb as Vec3,
    mad,
    clip_high: hi / n,
    clip_low: lo / n,
    outlier_fraction: outliers,
    ok: idx.length === k * k && mad <= madMax && outliers <= MAX_OUTLIER_FRACTION,
  };
}

export interface RoiMeasurement {
  lab: Lab;
  /** Corrected median, linear RGB. */
  linear: Vec3;
  spread_de00_p90: number;
  area_px: number;
  /** Fraction of ROI pixels with any raw channel >= 254 or <= 1. */
  clipped_fraction: number;
}

/** Spread is measured on SPREAD_BLOCK×SPREAD_BLOCK pixel blocks, not single
 * pixels. Sensor noise (amplified by the colour correction in dim light)
 * averages out within a block; a genuine second colour does not. Found in the
 * validation-study dry run: pale samples in dim light read as MULTIPLE_COLOURS
 * on per-pixel spread while their median matched to ~1 ΔE00. */
export const SPREAD_BLOCK = 4;
/** Below this many whole blocks (a tiny ROI) fall back to per-pixel spread. */
const MIN_BLOCKS = 12;

export function measureRoi(img: RgbaImage, roi: Circle, matrix: AffineMatrix, gamma = 1): RoiMeasurement {
  const idx = circleIndices(img, roi);
  const n = idx.length;
  if (n === 0) throw new Error("ROI contains no pixels");

  const lin: Vec3[] = new Array(n);
  let clipped = 0;
  for (let k = 0; k < n; k++) {
    const o = idx[k] * 4;
    const r = img.data[o];
    const g = img.data[o + 1];
    const b = img.data[o + 2];
    if (r >= 254 || g >= 254 || b >= 254 || r <= 1 || g <= 1 || b <= 1) clipped++;
    lin[k] = applyAffine(matrix, applyTone([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)], gamma));
  }

  const med: Vec3 = [
    median(lin.map((p) => p[0])),
    median(lin.map((p) => p[1])),
    median(lin.map((p) => p[2])),
  ];
  const lab = linearToLab(med);

  // Block means over blocks that lie wholly inside the circle.
  const inside = new Map<number, number>();
  idx.forEach((p, k) => inside.set(p, k));
  const d: number[] = [];
  const B = SPREAD_BLOCK;
  const x0 = Math.ceil(roi.x - roi.r);
  const y0 = Math.ceil(roi.y - roi.r);
  for (let by = y0; by + B <= roi.y + roi.r + 1; by += B) {
    for (let bx = x0; bx + B <= roi.x + roi.r + 1; bx += B) {
      const acc: Vec3 = [0, 0, 0];
      let full = true;
      for (let yy = by; yy < by + B && full; yy++)
        for (let xx = bx; xx < bx + B; xx++) {
          const k = xx >= 0 && yy >= 0 && xx < img.width && yy < img.height ? inside.get(yy * img.width + xx) : undefined;
          if (k === undefined) {
            full = false;
            break;
          }
          acc[0] += lin[k][0];
          acc[1] += lin[k][1];
          acc[2] += lin[k][2];
        }
      if (full) d.push(deltaE00(linearToLab([acc[0] / (B * B), acc[1] / (B * B), acc[2] / (B * B)]), lab));
    }
  }
  if (d.length < MIN_BLOCKS) {
    d.length = 0;
    for (let k = 0; k < n; k++) d.push(deltaE00(linearToLab(lin[k]), lab));
  }

  return {
    lab,
    linear: med,
    spread_de00_p90: percentile(d, 90),
    area_px: n,
    clipped_fraction: clipped / n,
  };
}
