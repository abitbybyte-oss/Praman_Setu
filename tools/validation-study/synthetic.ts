import {
  applyHomography,
  CORNER_ORDER,
  homographyFrom4,
  IDENTITY_AFFINE,
  labToLinear,
  linearToSrgb,
  measureRoi,
  PATCH_ORDER,
  type CornerId,
  type Lab,
  type Point,
  type RgbaImage,
} from "@fdtc/color-core";

import { calibrateCard, defaultRoiRadius, measureSample, snapCorner } from "../../apps/mobile/src/services/measure";
import { cardReference, DEFAULT_CARD, loadRefdb } from "../../apps/mobile/src/services/refdb";
import type { StudyRow } from "../../apps/mobile/src/services/studyCsv";

/** Synthetic dry run of the study protocol: every simulated swatch in the
 * Reference DB, under 4 simulated lights, 5 captures each, through the app's
 * real measurement pipeline. It proves the tooling end to end; it is NOT
 * evidence of real-world accuracy — only the phone study is. */

const W = 900;
const H = 1200;
const ref = cardReference(DEFAULT_CARD)!;
const L = ref.layout!;
const CARD: Point[] = [[130, 180], [790, 210], [770, 590], [150, 565]];
const ROI: Point = [450, 900];

// Linear-RGB camera responses per light (3x4 row-major) + noise level.
export const LIGHTS: Record<string, { m: number[]; noise: number }> = {
  DAYLIGHT: { m: [0.92, 0.02, 0, 0.002, 0.01, 0.9, 0.02, 0.002, 0, 0.02, 0.88, 0.002], noise: 3 },
  LED_COOL: { m: [0.62, 0.02, 0.03, 0, 0.01, 0.8, 0.05, 0, 0.02, 0.06, 0.9, 0.004], noise: 4 },
  TUNGSTEN_WARM: { m: [0.95, 0.05, 0, 0.004, 0.02, 0.78, 0.02, 0.003, 0, 0.04, 0.55, 0.002], noise: 4 },
  DIM_INDOOR: { m: [0.45, 0.02, 0.01, 0.003, 0.01, 0.43, 0.02, 0.003, 0.01, 0.02, 0.38, 0.003], noise: 7 },
};

function render(sample: Lab, light: { m: number[]; noise: number }, seed: number): { img: RgbaImage; markers: Record<CornerId, Point> } {
  const mm: Point[] = [[0, 0], [L.width_mm, 0], [L.width_mm, L.height_mm], [0, L.height_mm]];
  const toCard = homographyFrom4(CARD, mm);
  const toImg = homographyFrom4(mm, CARD);
  const patch = new Map(ref.patches.map((p) => [p.id, labToLinear(p.lab)]));
  const paper = labToLinear([80, 0, 2]);
  const table = labToLinear([38, 3, 9]);
  const ink = labToLinear([12, 0, 0]);
  const dot = labToLinear([95, 0, 0]);
  const reaction = labToLinear(sample);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const m = light.m;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let lin = table;
      if (Math.hypot(x - ROI[0], y - ROI[1]) < 110) lin = reaction;
      else {
        const [u, v] = applyHomography(toCard, [x, y]);
        if (u >= 0 && v >= 0 && u <= L.width_mm && v <= L.height_mm) {
          lin = paper;
          for (const id of PATCH_ORDER) {
            const p = L.patches_mm[id];
            if (u >= p.x && u < p.x + p.size && v >= p.y && v < p.y + p.size) lin = patch.get(id)!;
          }
          for (const c of CORNER_ORDER) {
            const [mx, my] = L.markers_mm[c];
            const d = Math.hypot(u - mx, v - my);
            if (d <= L.marker_diameter_mm / 2) lin = d <= 0.7 ? dot : ink;
          }
        }
      }
      const i = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const val = m[ch * 4] * lin[0] + m[ch * 4 + 1] * lin[1] + m[ch * 4 + 2] * lin[2] + m[ch * 4 + 3];
        data[i + ch] = Math.round(linearToSrgb(Math.max(0, val)) + (rnd() + rnd() + rnd() - 1.5) * light.noise);
      }
      data[i + 3] = 255;
    }
  const markers = Object.fromEntries(CORNER_ORDER.map((c) => [c, applyHomography(toImg, L.markers_mm[c])])) as Record<CornerId, Point>;
  return { img: { width: W, height: H, data }, markers };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function syntheticStudy(capturesPerCell = 5): StudyRow[] {
  const refdb = loadRefdb();
  const rows: StudyRow[] = [];
  let seed = 1;
  for (const [kitType, kit] of Object.entries(refdb.db.kits)) {
    for (const cls of kit.classes) {
      for (const [lighting, light] of Object.entries(LIGHTS)) {
        for (let k = 0; k < capturesPerCell; k++) {
          seed++;
          // Printed swatches vary a little from the exemplar and between prints.
          const jitter = (i: number) => ((((seed * 2654435761 + i * 40503) >>> 0) % 1000) / 1000 - 0.5) * 3;
          const ex = cls.exemplars_lab[0];
          const truth: Lab = [ex[0] + jitter(1), ex[1] + jitter(2), ex[2] + jitter(3)];
          const { img, markers } = render(truth, light, seed * 7919);
          const taps = Object.fromEntries(CORNER_ORDER.map((c) => [c, snapCorner(img, [markers[c][0] + 6, markers[c][1] - 5]).point])) as Record<CornerId, Point>;
          const card = calibrateCard(img, taps);
          const circle = { x: ROI[0], y: ROI[1], r: defaultRoiRadius(img) };
          const raw = measureRoi(img, circle, IDENTITY_AFFINE).lab;
          const valid = card.calibration.card_status === "VALID";
          const s = valid ? measureSample(img, circle, card, kitType) : null;
          const c = s?.classification;
          rows.push({
            study_id: `SYN-${String(rows.length + 1).padStart(4, "0")}`,
            captured_at: new Date(Date.UTC(2026, 8, 24, 10, 0, rows.length)).toISOString(),
            source: "SYNTHETIC",
            device: "synthetic-camera",
            lighting,
            kit_type: kitType,
            true_class: cls.id,
            true_outcome: cls.outcome,
            pred_outcome: c?.outcome ?? "INCONCLUSIVE",
            pred_class: c?.class_id ?? "",
            confidence: c ? Math.round(c.confidence * 1000) / 1000 : null,
            d1_de00: c?.d1_de00 != null ? r2(c.d1_de00) : null,
            d2_de00: c?.d2_de00 != null ? r2(c.d2_de00) : null,
            raw_L: r2(raw[0]),
            raw_a: r2(raw[1]),
            raw_b: r2(raw[2]),
            cal_L: s ? r2(s.roi.lab[0]) : null,
            cal_a: s ? r2(s.roi.lab[1]) : null,
            cal_b: s ? r2(s.roi.lab[2]) : null,
            residual_de00_mean: valid ? r2(card.calibration.residual_de00_mean) : null,
            card_status: card.calibration.card_status,
            quality_score: s?.quality.score ?? null,
            quality_band: s?.quality.band ?? "POOR",
            reasons: c?.inconclusive_reasons.join(" ") ?? "CARD_CALIBRATION_FAILED",
          });
        }
      }
    }
  }
  return rows;
}
