/** Colour space conversions (ARCHITECTURE §6.1).
 *
 * sRGB (8-bit, companded) <-> linear sRGB <-> CIE XYZ (D65) <-> CIELAB (D65).
 * Linear values are not clamped: out-of-gamut reference colours (for example a
 * saturated red patch) are valid targets for the colour-correction fit. */

export type Vec3 = [number, number, number];
export type Lab = Vec3;

/** D65 reference white, Y normalised to 1. */
export const D65: Vec3 = [0.95047, 1.0, 1.08883];

export function srgbToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return v * 255;
}

export function srgb8ToLinear(rgb: Vec3): Vec3 {
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
}

export function linearToSrgb8(rgb: Vec3): Vec3 {
  return [linearToSrgb(rgb[0]), linearToSrgb(rgb[1]), linearToSrgb(rgb[2])];
}

export function linearToXyz([r, g, b]: Vec3): Vec3 {
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ];
}

export function xyzToLinear([x, y, z]: Vec3): Vec3 {
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

function f(t: number): number {
  return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
}

function fInv(t: number): number {
  const t3 = t * t * t;
  return t3 > EPS ? t3 : (116 * t - 16) / KAPPA;
}

export function xyzToLab([x, y, z]: Vec3): Lab {
  const fx = f(x / D65[0]);
  const fy = f(y / D65[1]);
  const fz = f(z / D65[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToXyz([L, a, b]: Lab): Vec3 {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  return [fInv(fx) * D65[0], fInv(fy) * D65[1], fInv(fz) * D65[2]];
}

export function linearToLab(rgb: Vec3): Lab {
  return xyzToLab(linearToXyz(rgb));
}

export function labToLinear(lab: Lab): Vec3 {
  return xyzToLinear(labToXyz(lab));
}

export function srgb8ToLab(rgb: Vec3): Lab {
  return linearToLab(srgb8ToLinear(rgb));
}

export function labToSrgb8(lab: Lab): Vec3 {
  return linearToSrgb8(labToLinear(lab));
}

/** Relative luminance of an 8-bit sRGB triple, 0..1. */
export function luminance8(rgb: Vec3): number {
  const l = srgb8ToLinear(rgb);
  return 0.2126729 * l[0] + 0.7151522 * l[1] + 0.072175 * l[2];
}

export function chroma([, a, b]: Lab): number {
  return Math.hypot(a, b);
}
