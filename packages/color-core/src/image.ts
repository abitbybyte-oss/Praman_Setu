import type { Vec3 } from "./color";

/** An RGBA8 pixel buffer, as returned by Skia readPixels (or jpeg-js in Node).
 * color-core never decodes images itself. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export function pixel(img: RgbaImage, x: number, y: number): Vec3 {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

export function clampRect(img: RgbaImage, r: Rect): Rect {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(img.width, Math.floor(r.x + r.w));
  const y1 = Math.min(img.height, Math.floor(r.y + r.h));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Pixel offsets (row-major) inside a circle, clipped to the image. */
export function circleIndices(img: RgbaImage, c: Circle): number[] {
  const out: number[] = [];
  const r2 = c.r * c.r;
  const y0 = Math.max(0, Math.ceil(c.y - c.r));
  const y1 = Math.min(img.height - 1, Math.floor(c.y + c.r));
  const x0 = Math.max(0, Math.ceil(c.x - c.r));
  const x1 = Math.min(img.width - 1, Math.floor(c.x + c.r));
  for (let y = y0; y <= y1; y++) {
    const dy = y - c.y;
    for (let x = x0; x <= x1; x++) {
      const dx = x - c.x;
      if (dx * dx + dy * dy <= r2) out.push(y * img.width + x);
    }
  }
  return out;
}

export function rectIndices(img: RgbaImage, rect: Rect): number[] {
  const r = clampRect(img, rect);
  const out: number[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push(y * img.width + x);
  return out;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Nearest-rank percentile, p in [0, 100]. Deterministic, no interpolation. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[rank];
}

export function channelValues(img: RgbaImage, indices: number[], ch: 0 | 1 | 2): number[] {
  const out = new Array<number>(indices.length);
  for (let k = 0; k < indices.length; k++) out[k] = img.data[indices[k] * 4 + ch];
  return out;
}
