import { describe, expect, it } from "vitest";
import { calibrate, PATCH_ORDER } from "../card";
import { deltaE00 } from "../ciede2000";
import { labToLinear, linearToSrgb, type Lab } from "../color";
import {
  applyHomography,
  cardHomography,
  checkCorners,
  CORNER_ORDER,
  homographyFrom4,
  locatePatches,
  sampleCard,
  type CardLayout,
  type CornerId,
  type Point,
} from "../geometry";
import type { RgbaImage } from "../image";
import { CARD, WARM_CAST } from "./fixtures";

// Must match packages/refdb/src/refdb.source.json → cards.FDTC-CARD-1.layout
const LAYOUT: CardLayout = {
  width_mm: 110,
  height_mm: 64,
  markers_mm: { top_left: [6, 6], top_right: [104, 6], bottom_right: [104, 58], bottom_left: [6, 58] },
  marker_diameter_mm: 7,
  patches_mm: {
    white: { x: 12, y: 10, size: 18 },
    black: { x: 34, y: 10, size: 18 },
    red: { x: 56, y: 10, size: 18 },
    green: { x: 12, y: 32, size: 18 },
    blue: { x: 34, y: 32, size: 18 },
    gray: { x: 56, y: 32, size: 18 },
  },
  sample_fraction: 0.5,
};
const REF = { ...CARD, layout: LAYOUT };

const W = 800;
const H = 600;

/** Card corners on screen: a perspective view, as if the phone is tilted. */
const CARD_ON_SCREEN: Point[] = [
  [140, 120], // card (0,0)
  [690, 150], // card (110,0)
  [650, 470], // card (110,64)
  [170, 430], // card (0,64)
];

function renderCard(opts: { cast?: number[]; noise?: number } = {}): { img: RgbaImage; toImg: number[] } {
  const cardCorners: Point[] = [
    [0, 0],
    [LAYOUT.width_mm, 0],
    [LAYOUT.width_mm, LAYOUT.height_mm],
    [0, LAYOUT.height_mm],
  ];
  const toCard = homographyFrom4(CARD_ON_SCREEN, cardCorners);
  const toImg = homographyFrom4(cardCorners, CARD_ON_SCREEN);
  const lab = new Map(CARD.patches.map((p) => [p.id, labToLinear(p.lab)]));
  const paper = labToLinear([80, 0, 2]);
  const table = labToLinear([35, 4, 8]);
  const ink = labToLinear([12, 0, 0]);
  const m = opts.cast ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  let seed = 5;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [u, v] = applyHomography(toCard, [x, y]);
      let lin = table;
      if (u >= 0 && v >= 0 && u <= LAYOUT.width_mm && v <= LAYOUT.height_mm) {
        lin = paper;
        for (const id of PATCH_ORDER) {
          const p = LAYOUT.patches_mm[id];
          if (u >= p.x && u < p.x + p.size && v >= p.y && v < p.y + p.size) lin = lab.get(id)!;
        }
        for (const c of CORNER_ORDER) {
          const [mx, my] = LAYOUT.markers_mm[c];
          if (Math.hypot(u - mx, v - my) <= LAYOUT.marker_diameter_mm / 2) lin = ink;
        }
      }
      const out = [0, 1, 2].map((ch) => m[ch * 4] * lin[0] + m[ch * 4 + 1] * lin[1] + m[ch * 4 + 2] * lin[2] + m[ch * 4 + 3]);
      const i = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const e = opts.noise ? (rnd() + rnd() + rnd() - 1.5) * opts.noise : 0;
        data[i + ch] = Math.round(linearToSrgb(Math.max(0, out[ch])) + e);
      }
      data[i + 3] = 255;
    }
  return { img: { width: W, height: H, data }, toImg };
}

/** Where the officer should tap: the marker centres, projected. */
function trueTaps(toImg: number[], jitter = 0): Record<CornerId, Point> {
  const t = {} as Record<CornerId, Point>;
  CORNER_ORDER.forEach((id, k) => {
    const [x, y] = applyHomography(toImg, LAYOUT.markers_mm[id]);
    t[id] = [x + (k % 2 ? jitter : -jitter), y + (k < 2 ? jitter : -jitter)];
  });
  return t;
}

describe("homography", () => {
  it("maps the four source points exactly onto the destination points", () => {
    const src: Point[] = [[0, 0], [110, 0], [110, 64], [0, 64]];
    const h = homographyFrom4(src, CARD_ON_SCREEN);
    src.forEach((p, i) => {
      const q = applyHomography(h, p);
      expect(q[0]).toBeCloseTo(CARD_ON_SCREEN[i][0], 6);
      expect(q[1]).toBeCloseTo(CARD_ON_SCREEN[i][1], 6);
    });
  });

  it("rejects three collinear taps", () => {
    expect(() => homographyFrom4([[0, 0], [1, 0], [2, 0], [0, 1]], CARD_ON_SCREEN)).toThrow();
  });
});

describe("corner taps", () => {
  const { img, toImg } = renderCard();

  it("accepts correct taps", () => {
    expect(checkCorners(LAYOUT, trueTaps(toImg), img)).toEqual({ ok: true, problems: [] });
  });

  it("rejects taps in the wrong order (anticlockwise)", () => {
    const t = trueTaps(toImg);
    const swapped = { ...t, top_right: t.bottom_left, bottom_left: t.top_right };
    expect(checkCorners(LAYOUT, swapped, img).problems).toContain("WRONG_ORDER");
  });

  it("rejects crossed taps", () => {
    const t = trueTaps(toImg);
    const crossed = { ...t, bottom_right: t.bottom_left, bottom_left: t.bottom_right };
    expect(checkCorners(LAYOUT, crossed, img).problems).toContain("NOT_CONVEX");
  });

  it("rejects a card that is far too small in the frame", () => {
    const tiny: Record<CornerId, Point> = { top_left: [10, 10], top_right: [40, 10], bottom_right: [40, 28], bottom_left: [10, 28] };
    expect(checkCorners(LAYOUT, tiny, img).problems).toContain("TOO_SMALL");
  });

  it("puts every patch centre inside its patch", () => {
    const patches = locatePatches(LAYOUT, cardHomography(LAYOUT, trueTaps(toImg)));
    const inv = homographyFrom4(CARD_ON_SCREEN, [[0, 0], [110, 0], [110, 64], [0, 64]]);
    for (const p of patches) {
      const [u, v] = applyHomography(inv, p.centre);
      const r = LAYOUT.patches_mm[p.id];
      expect(Math.abs(u - (r.x + r.size / 2))).toBeLessThan(0.2);
      expect(Math.abs(v - (r.y + r.size / 2))).toBeLessThan(0.2);
      expect(p.window % 2).toBe(1);
      expect(p.window).toBeGreaterThanOrEqual(15);
    }
  });
});

describe("printed card end to end", () => {
  it.each([0, 6])("tilted card, warm light, noise, taps off by %i px → card VALID, ΔE00 < 1", (jitter) => {
    const { img, toImg } = renderCard({ cast: WARM_CAST, noise: 5 });
    const s = sampleCard(img, LAYOUT, trueTaps(toImg, jitter));
    expect(s.corners.ok).toBe(true);
    for (const id of PATCH_ORDER) expect(s.samples[id]!.ok).toBe(true);

    const cal = calibrate(s.samples, REF, img);
    expect(cal.failed_checks).toEqual([]);
    expect(cal.card_status).toBe("VALID");
    expect(cal.residual_de00_mean).toBeLessThan(1);
  });

  it("calibrated patch colours match the Reference DB", () => {
    const { img, toImg } = renderCard({ cast: WARM_CAST, noise: 3 });
    const cal = calibrate(sampleCard(img, LAYOUT, trueTaps(toImg)).samples, REF, img);
    for (const p of CARD.patches) expect(cal.residuals_de00[p.id]).toBeLessThan(1.5);
    const white: Lab = CARD.patches[0].lab;
    expect(white[0]).toBe(95);
  });
});
