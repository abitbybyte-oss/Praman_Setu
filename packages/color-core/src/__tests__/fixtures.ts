import { labToLinear, linearToSrgb, type Lab, type Vec3 } from "../color";
import type { CardReference, PatchId } from "../card";
import { PATCH_ORDER } from "../card";
import type { RgbaImage } from "../image";

/** Synthetic scenes for color-core tests: a 6-patch card plus a circular
 * reaction area, rendered under a known linear colour cast with noise. */

export const CARD: CardReference = {
  patches: [
    { id: "white", lab: [95.0, -0.5, 2.0] },
    { id: "black", lab: [18.0, 0.3, -0.8] },
    { id: "red", lab: [44.0, 60.0, 38.0] },
    { id: "green", lab: [55.0, -45.0, 30.0] },
    { id: "blue", lab: [34.0, 14.0, -48.0] },
    { id: "gray", lab: [55.0, 0.0, 0.5] },
  ],
  checks: { residual_mean_max: 3.0, residual_max_max: 6.0, neutral_ab_max: 8.0, clip_frac_max: 0.02 },
};

export const PATCH_SIZE = 60;
export const W = 480;
export const H = 320;

/** Patch centres: two rows of three along the top of the frame. */
export const PATCH_XY: Record<PatchId, [number, number]> = Object.fromEntries(
  PATCH_ORDER.map((id, i) => [id, [50 + (i % 3) * 80, 50 + Math.floor(i / 3) * 80]])
) as Record<PatchId, [number, number]>;

export const ROI = { x: 360, y: 220, r: 40 };

export interface Scene {
  /** Linear-RGB transform applied to the true scene (the "camera"). */
  cast?: number[]; // 3x4 row-major
  noise?: number; // 8-bit std-dev-ish amplitude
  gamma?: number; // extra non-linearity applied in linear space
  sample: Lab | { inner: Lab; outer: Lab };
  background?: Lab;
  blurRadius?: number;
  glareSpots?: { x: number; y: number; r: number }[];
  seed?: number;
}

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function toPixel(lin: Vec3, s: Scene, rnd: () => number): Vec3 {
  const m = s.cast ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  let v: Vec3 = [
    m[0] * lin[0] + m[1] * lin[1] + m[2] * lin[2] + m[3],
    m[4] * lin[0] + m[5] * lin[1] + m[6] * lin[2] + m[7],
    m[8] * lin[0] + m[9] * lin[1] + m[10] * lin[2] + m[11],
  ];
  if (s.gamma) v = v.map((c) => Math.pow(Math.max(0, c), s.gamma!)) as Vec3;
  const n = s.noise ?? 0;
  return v.map((c) => {
    const e = n ? (rnd() + rnd() + rnd() - 1.5) * n : 0;
    return Math.min(255, Math.max(0, Math.round(linearToSrgb(Math.max(0, c)) + e)));
  }) as Vec3;
}

export function renderScene(s: Scene): RgbaImage {
  const rnd = lcg(s.seed ?? 1);
  const data = new Uint8ClampedArray(W * H * 4);
  const bg = labToLinear(s.background ?? [40, 2, 5]);
  const patchLin = new Map(CARD.patches.map((p) => [p.id, labToLinear(p.lab)]));
  const inner = "inner" in s.sample ? s.sample.inner : s.sample;
  const outer = "outer" in s.sample ? s.sample.outer : s.sample;
  const innerLin = labToLinear(inner);
  const outerLin = labToLinear(outer);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let lin = bg;
      for (const id of PATCH_ORDER) {
        const [cx, cy] = PATCH_XY[id];
        if (Math.abs(x - cx) < PATCH_SIZE / 2 && Math.abs(y - cy) < PATCH_SIZE / 2) lin = patchLin.get(id)!;
      }
      const d = Math.hypot(x - ROI.x, y - ROI.y);
      if (d <= ROI.r + 10) lin = x < ROI.x ? innerLin : outerLin;
      let px = toPixel(lin, s, rnd);
      for (const g of s.glareSpots ?? []) if (Math.hypot(x - g.x, y - g.y) <= g.r) px = [255, 255, 255];
      const i = (y * W + x) * 4;
      data[i] = px[0];
      data[i + 1] = px[1];
      data[i + 2] = px[2];
      data[i + 3] = 255;
    }
  }
  const img = { width: W, height: H, data };
  return s.blurRadius ? boxBlur(img, s.blurRadius) : img;
}

export function boxBlur(img: RgbaImage, r: number): RgbaImage {
  const out = new Uint8ClampedArray(img.data.length);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const acc = [0, 0, 0];
      let n = 0;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(img.width - 1, Math.max(0, x + dx));
          const yy = Math.min(img.height - 1, Math.max(0, y + dy));
          const i = (yy * img.width + xx) * 4;
          acc[0] += img.data[i];
          acc[1] += img.data[i + 1];
          acc[2] += img.data[i + 2];
          n++;
        }
      const o = (y * img.width + x) * 4;
      out[o] = acc[0] / n;
      out[o + 1] = acc[1] / n;
      out[o + 2] = acc[2] / n;
      out[o + 3] = 255;
    }
  }
  return { width: img.width, height: img.height, data: out };
}

/** A warm tungsten-like cast, 0.8x exposure, slight channel crosstalk. */
export const WARM_CAST = [0.95, 0.05, 0.0, 0.004, 0.02, 0.78, 0.02, 0.003, 0.0, 0.04, 0.55, 0.002];
/** A cool daylight/LED cast. */
export const COOL_CAST = [0.62, 0.02, 0.03, 0.0, 0.01, 0.8, 0.05, 0.0, 0.02, 0.06, 0.9, 0.004];
