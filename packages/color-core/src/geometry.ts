import type { PatchId } from "./card";
import type { RgbaImage } from "./image";
import { DEFAULT_PATCH_MAD_MAX, samplePatch, type PatchSample } from "./sampling";

/** Printed-card geometry (ARCHITECTURE §6.1, "Card layout").
 *
 * The officer taps the card's four corner markers; a homography from card
 * millimetres to image pixels then locates every patch. This replaces six
 * patch taps and copes with the phone being held at an angle. */

export type Point = [number, number];

/** Corner order is always as seen with the card upright (text readable). */
export const CORNER_ORDER = ["top_left", "top_right", "bottom_right", "bottom_left"] as const;
export type CornerId = (typeof CORNER_ORDER)[number];

export interface CardLayout {
  /** Card size in millimetres. */
  width_mm: number;
  height_mm: number;
  /** Corner marker centres in card millimetres, in CORNER_ORDER. */
  markers_mm: Record<CornerId, Point>;
  marker_diameter_mm: number;
  /** Patch squares in card millimetres (top-left corner + size). */
  patches_mm: Record<PatchId, { x: number; y: number; size: number }>;
  /** Fraction of the patch width used for sampling (keeps clear of the edges). */
  sample_fraction: number;
}

/** 3x3 homography, row-major, h[8] = 1. */
export type Homography = number[];

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error("corner taps are degenerate (three in a line?)");
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Homography mapping four source points onto four destination points. */
export function homographyFrom4(src: Point[], dst: Point[]): Homography {
  if (src.length !== 4 || dst.length !== 4) throw new Error("need exactly 4 point pairs");
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return [...solve(A, b), 1];
}

export function applyHomography(h: Homography, [x, y]: Point): Point {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export interface CornerCheck {
  ok: boolean;
  /** Reasons the taps were rejected, for the "retap corners" prompt. */
  problems: ("NOT_CONVEX" | "TOO_SMALL" | "WRONG_ORDER" | "BAD_ASPECT")[];
}

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Sanity checks on the four taps before trusting the homography. */
export function checkCorners(
  layout: CardLayout,
  taps: Record<CornerId, Point>,
  image: { width: number; height: number }
): CornerCheck {
  const q = CORNER_ORDER.map((id) => taps[id]);
  const problems: CornerCheck["problems"] = [];

  const turns = [0, 1, 2, 3].map((i) => cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]));
  const convex = turns.every((t) => t > 0) || turns.every((t) => t < 0);
  if (!convex) problems.push("NOT_CONVEX");
  // Image y points down, so a clockwise TL→TR→BR→BL on screen has positive turns.
  else if (turns[0] < 0) problems.push("WRONG_ORDER");

  let area = 0;
  for (let i = 0; i < 4; i++) area += q[i][0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * q[i][1];
  area = Math.abs(area) / 2;
  if (area < 0.01 * image.width * image.height) problems.push("TOO_SMALL");

  const side = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const wPx = (side(q[0], q[1]) + side(q[3], q[2])) / 2;
  const hPx = (side(q[0], q[3]) + side(q[1], q[2])) / 2;
  const m = layout.markers_mm;
  const expected = (m.top_right[0] - m.top_left[0]) / (m.bottom_left[1] - m.top_left[1]);
  const ratio = hPx > 0 ? wPx / hPx / expected : 0;
  // Generous: foreshortening at a steep angle can squash one axis.
  if (ratio < 0.5 || ratio > 2) problems.push("BAD_ASPECT");

  return { ok: problems.length === 0, problems };
}

export interface LocatedPatch {
  id: PatchId;
  centre: Point;
  /** Odd sampling-window size in pixels, from the patch's projected size. */
  window: number;
  /** Projected patch outline, for drawing on screen. */
  outline: Point[];
}

/** Card-mm → image-px homography from the four tapped corner markers. */
export function cardHomography(layout: CardLayout, taps: Record<CornerId, Point>): Homography {
  return homographyFrom4(
    CORNER_ORDER.map((id) => layout.markers_mm[id]),
    CORNER_ORDER.map((id) => taps[id])
  );
}

export function locatePatches(layout: CardLayout, h: Homography, maxWindow = 61): LocatedPatch[] {
  return (Object.keys(layout.patches_mm) as PatchId[]).map((id) => {
    const p = layout.patches_mm[id];
    const outline: Point[] = [
      [p.x, p.y],
      [p.x + p.size, p.y],
      [p.x + p.size, p.y + p.size],
      [p.x, p.y + p.size],
    ].map((pt) => applyHomography(h, pt as Point));
    const centre = applyHomography(h, [p.x + p.size / 2, p.y + p.size / 2]);
    // The shortest projected side bounds the window, so it stays inside the patch.
    const sides = outline.map((a, i) => Math.hypot(a[0] - outline[(i + 1) % 4][0], a[1] - outline[(i + 1) % 4][1]));
    let window = Math.floor(Math.min(...sides) * layout.sample_fraction);
    window = Math.max(5, Math.min(maxWindow, window % 2 ? window : window - 1));
    return { id, centre, window, outline };
  });
}

export interface CardSampling {
  corners: CornerCheck;
  homography: Homography | null;
  patches: LocatedPatch[];
  samples: Partial<Record<PatchId, PatchSample>>;
}

/** Corner taps → corner sanity check → homography → sample all six patches.
 * The result's `samples` feeds calibrate() unchanged. */
export function sampleCard(
  img: RgbaImage,
  layout: CardLayout,
  taps: Record<CornerId, Point>,
  madMax: number = DEFAULT_PATCH_MAD_MAX
): CardSampling {
  const corners = checkCorners(layout, taps, img);
  if (!corners.ok) return { corners, homography: null, patches: [], samples: {} };
  const homography = cardHomography(layout, taps);
  const patches = locatePatches(layout, homography);
  const samples: Partial<Record<PatchId, PatchSample>> = {};
  for (const p of patches) samples[p.id] = samplePatch(img, p.centre[0], p.centre[1], p.window, madMax);
  return { corners, homography, patches, samples };
}
