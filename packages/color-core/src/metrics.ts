import { chroma, type Lab } from "./color";
import { circleIndices, clampRect, median, type Circle, type Rect, type RgbaImage } from "./image";

/** Image quality metrics (ARCHITECTURE §6.1). */

function gray(img: RgbaImage, x: number, y: number): number {
  const i = (y * img.width + x) * 4;
  return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
}

/** Variance of the 3x3 (4-neighbour) Laplacian of the grayscale image over
 * `region` (default: whole image). Higher is sharper. */
export function laplacianVariance(img: RgbaImage, region?: Rect): number {
  const r = clampRect(img, region ?? { x: 0, y: 0, w: img.width, h: img.height });
  const x0 = Math.max(1, r.x);
  const y0 = Math.max(1, r.y);
  const x1 = Math.min(img.width - 1, r.x + r.w);
  const y1 = Math.min(img.height - 1, r.y + r.h);
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = gray(img, x - 1, y) + gray(img, x + 1, y) + gray(img, x, y - 1) + gray(img, x, y + 1) - 4 * gray(img, x, y);
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Fraction of pixels in `region` with any channel >= 254 or <= 1. */
export function clippedFraction(img: RgbaImage, region: Rect): number {
  const r = clampRect(img, region);
  let clipped = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * img.width + x) * 4;
      const a = img.data[i];
      const b = img.data[i + 1];
      const c = img.data[i + 2];
      if (a >= 254 || b >= 254 || c >= 254 || a <= 1 || b <= 1 || c <= 1) clipped++;
    }
  }
  return r.w * r.h ? clipped / (r.w * r.h) : 0;
}

export interface GlareResult {
  glare_fraction: number;
  /** True when the pale-sample exemption applied and glare was set to 0. */
  pale_exempt: boolean;
  raw_fraction: number;
}

const GLARE_LEVEL = 245;
const GLARE_CONTRAST = 40;

/** Glare in the ROI: raw pixels with every channel >= 245 that are much
 * brighter (>= 40 grey levels) than the ROI's median, i.e. a specular
 * highlight on a darker sample rather than a uniformly pale sample.
 *
 * Pale-sample exemption: when the corrected ROI median is very light and
 * nearly neutral (L* >= 85, chroma < 10) and less than 0.5% of pixels clip,
 * the sample is a clear liquid, not glare. */
export function glareFraction(img: RgbaImage, roi: Circle, correctedLab?: Lab, clippedFrac?: number): GlareResult {
  const idx = circleIndices(img, roi);
  if (idx.length === 0) return { glare_fraction: 0, pale_exempt: false, raw_fraction: 0 };
  const grays = idx.map((p) => {
    const x = p % img.width;
    return gray(img, x, (p - x) / img.width);
  });
  const med = median(grays);
  let glare = 0;
  idx.forEach((p, k) => {
    const o = p * 4;
    if (img.data[o] < GLARE_LEVEL || img.data[o + 1] < GLARE_LEVEL || img.data[o + 2] < GLARE_LEVEL) return;
    if (grays[k] - med >= GLARE_CONTRAST) glare++;
  });
  const raw = glare / idx.length;
  const pale =
    !!correctedLab && correctedLab[0] >= 85 && chroma(correctedLab) < 10 && (clippedFrac ?? 1) < 0.005;
  return { glare_fraction: pale ? 0 : raw, pale_exempt: pale, raw_fraction: raw };
}
