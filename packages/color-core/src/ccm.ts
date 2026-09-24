import type { Vec3 } from "./color";

/** Affine 3x4 colour correction (ARCHITECTURE §6.1, ADR-012).
 *
 * Least squares fit of M so that M · [r g b 1]ᵀ ≈ reference linear RGB for
 * every card patch, in linear sRGB. A small ridge term pulls the 3x3 part
 * towards identity and the offset towards zero, which keeps the fit stable
 * when patches are nearly collinear. Row-major: [m00 m01 m02 t0, m10 … t1, m20 … t2]. */

export type AffineMatrix = number[];

export const IDENTITY_AFFINE: AffineMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
export const DEFAULT_RIDGE = 1e-4;

export function applyAffine(m: AffineMatrix, [r, g, b]: Vec3): Vec3 {
  return [
    m[0] * r + m[1] * g + m[2] * b + m[3],
    m[4] * r + m[5] * g + m[6] * b + m[7],
    m[8] * r + m[9] * g + m[10] * b + m[11],
  ];
}

/** Solve A x = y for a small dense system by Gaussian elimination with partial pivoting. */
function solve(A: number[][], y: number[]): number[] {
  const n = y.length;
  const M = A.map((row, i) => [...row, y[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error("colour correction fit is singular");
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function fitAffine(measured: Vec3[], reference: Vec3[], ridge: number = DEFAULT_RIDGE): AffineMatrix {
  if (measured.length !== reference.length) throw new Error("measured and reference patch counts differ");
  if (measured.length < 4) throw new Error("at least 4 patches are needed for an affine fit");

  // Normal equations, shared by all three output channels: (XᵀX + λI) w = Xᵀy + λ w0
  const XtX = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
  for (const m of measured) {
    const x = [m[0], m[1], m[2], 1];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) XtX[i][j] += x[i] * x[j];
  }
  for (let i = 0; i < 4; i++) XtX[i][i] += ridge;

  const out: number[] = [];
  for (let c = 0; c < 3; c++) {
    const prior = [0, 0, 0, 0];
    prior[c] = 1;
    const Xty = prior.map((p) => ridge * p);
    measured.forEach((m, k) => {
      const x = [m[0], m[1], m[2], 1];
      for (let i = 0; i < 4; i++) Xty[i] += x[i] * reference[k][c];
    });
    out.push(...solve(XtX, Xty));
  }
  return out;
}

/** Apply the colour correction to a whole RGBA8 image, for display (ROI-01).
 * Lookup tables keep it fast enough for a 1600 px working copy on a phone:
 * sRGB→linear is a 256-entry table, linear→sRGB a 4096-entry table. */
export function correctImage(
  img: { width: number; height: number; data: Uint8Array | Uint8ClampedArray },
  m: AffineMatrix
): Uint8ClampedArray {
  const toLin = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    toLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  const N = 4096;
  const toSrgb = new Uint8ClampedArray(N + 1);
  for (let i = 0; i <= N; i++) {
    const c = i / N;
    toSrgb[i] = Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
  }
  const enc = (v: number) => toSrgb[v <= 0 ? 0 : v >= 1 ? N : Math.round(v * N)];
  const out = new Uint8ClampedArray(img.data.length);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = toLin[d[i]];
    const g = toLin[d[i + 1]];
    const b = toLin[d[i + 2]];
    out[i] = enc(m[0] * r + m[1] * g + m[2] * b + m[3]);
    out[i + 1] = enc(m[4] * r + m[5] * g + m[6] * b + m[7]);
    out[i + 2] = enc(m[8] * r + m[9] * g + m[10] * b + m[11]);
    out[i + 3] = 255;
  }
  return out;
}
