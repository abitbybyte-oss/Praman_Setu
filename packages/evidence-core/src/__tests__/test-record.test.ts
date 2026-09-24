import { describe, expect, it } from "vitest";
import { parseTestRecord, roundTo, type TestRecord } from "../test-record";

const H = (c: string) => c.repeat(64);

function valid(): TestRecord {
  return {
    schema: "fdtc.test/1",
    record_type: "TEST",
    record_id: "0192a5c4-7e1b-7c3a-9f10-2b6d8e4f1a77",
    device_id: "dev_7F3A9C",
    key_id: "k_3QmZq8R1xV0bT2nL",
    seq: 3,
    prev_hash: H("c"),
    created_at: "2026-09-22T10:14:03.221Z",
    simulated: true,
    source: "CAMERA",
    operator: { badge_id: "1001", role: "OFFICER", auth_method: "PIN" },
    case: { case_id: "FIR-0419-2026", witness_badge_id: null },
    kit: { kit_type: "SIM-A", display_name: "Simulated Test A", entry: "MANUAL", kit_id: null, manufacturer: null, batch: null, mfg_date: null, expiry_date: null, status: "NOT_CHECKED", qr_sha256: null },
    timing: { timer: "NONE", timer_start: null, capture_time: "2026-09-22T10:13:21.870Z", elapsed_s: null, required_s: 120, max_s: 300, in_window: null },
    captures: [
      { n: 1, sha256: H("a"), bytes: 2841123, taken_at: "2026-09-22T10:12:00.000Z", accepted: false, reject_reasons: ["IMAGE_BLURRY"], quality_score: null, laplacian_variance: 21.4 },
      { n: 2, sha256: H("b"), bytes: 2903311, taken_at: "2026-09-22T10:13:21.870Z", accepted: true, reject_reasons: [], quality_score: 92, laplacian_variance: 310.2 },
    ],
    evidence_image: { n: 2, sha256: H("b"), mime: "image/jpeg", bytes: 2903311, width: 2448, height: 3264 },
    working: { width: 1200, height: 1600, scale: 2.04 },
    calibration: {
      card_version: "FDTC-CARD-1",
      model: "affine3x4",
      locate: "corner-taps-homography/1",
      corners: { top_left: [100, 200], top_right: [900, 210], bottom_right: [890, 700], bottom_left: [110, 690] },
      corners_snapped: [true, true, true, true],
      patches: { white: { xy: [812, 1440], rgb: [231, 229, 224], mad: 1.2, window: 31 } },
      matrix: [1.08, -0.04, 0.01, 0.002, 0, 1, 0, 0, 0, 0, 1, 0],
      residual_de00_mean: 1.84,
      residual_de00_max: 3.12,
      card_status: "VALID",
      failed_checks: [],
    },
    measurement: { roi: { x: 2210, y: 1502, r: 64 }, lab: [48.21, 38.7, -22.05], spread_de00_p90: 2.31, area_px: 12868, glare_fraction: 0.001, pale_exempt: false },
    quality: { score: 92, band: "GOOD", components: { sharpness: 0.97 }, reasons: [], hard_gates: [] },
    classification: {
      algorithm: "nearest-class-de00/1",
      outcome: "PRELIMINARY_POSITIVE",
      class_id: "SIM-A-POS",
      class_label: "Simulated colour A",
      d1_de00: 4.21,
      d2_de00: 18.93,
      confidence: 0.636,
      uncertainty_de00: 2.2,
      inconclusive_reasons: [],
      recommended_action: null,
    },
    location: null,
    clock: { device_time: "2026-09-22T10:13:21.870Z", gnss_time: null, skew_s: null, monotonic_ms: 5543210 },
    integrity: { rooted: false, mock_location: null, clock_skew: null, location_unavailable: true },
    reference_db: { version: "2026.09-demo-1", sha256: H("7") },
    retest_of: null,
    retake_count: 1,
    ended_early: null,
    app: { version: "0.1.0", platform: "android 34" },
  };
}

describe("fdtc.test/1 schema", () => {
  it("accepts a well-formed record", () => {
    expect(() => parseTestRecord(valid())).not.toThrow();
  });

  it("rejects unknown fields", () => {
    expect(() => parseTestRecord({ ...valid(), extra: 1 })).toThrow(/Unrecognized key/);
  });

  it("rejects NaN and Infinity", () => {
    const r = valid();
    r.measurement!.spread_de00_p90 = NaN;
    expect(() => parseTestRecord(r)).toThrow();
    r.measurement!.spread_de00_p90 = Infinity;
    expect(() => parseTestRecord(r)).toThrow();
  });

  it("rejects a preliminary outcome on an invalid card", () => {
    const r = valid();
    r.calibration!.card_status = "INVALID";
    expect(() => parseTestRecord(r)).toThrow(/VALID card/);
  });

  it("rejects INCONCLUSIVE without a reason", () => {
    const r = valid();
    r.classification.outcome = "INCONCLUSIVE";
    expect(() => parseTestRecord(r)).toThrow(/at least one reason/);
  });

  it("requires the evidence image to be an accepted capture", () => {
    const r = valid();
    r.evidence_image!.sha256 = H("a");
    expect(() => parseTestRecord(r)).toThrow(/accepted capture/);
  });

  it("requires retake_count = captures - 1", () => {
    const r = valid();
    r.retake_count = 0;
    expect(() => parseTestRecord(r)).toThrow(/retake_count/);
  });

  it("a scanned kit must be VALID; a late capture must be Inconclusive", () => {
    const r = valid();
    r.kit = { ...r.kit, entry: "QR", status: "EXPIRED", qr_sha256: H("e") };
    expect(() => parseTestRecord(r)).toThrow(/VALID scanned kit/);
    const late = valid();
    late.timing = { ...late.timing, timer: "KIT_PROTOCOL", timer_start: "2026-09-22T10:00:00.000Z", elapsed_s: 400, in_window: false };
    expect(() => parseTestRecord(late)).toThrow(/reaction window/);
  });

  it("rejects timestamps without milliseconds or Z", () => {
    expect(() => parseTestRecord({ ...valid(), created_at: "2026-09-22T10:14:03Z" })).toThrow();
  });
});

describe("roundTo", () => {
  it("rounds half away from zero and normalises -0", () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-2.345, 2)).toBe(-2.35);
    expect(Object.is(roundTo(-0.0001, 2), 0)).toBe(true);
    expect(roundTo(28.6139123, 6)).toBe(28.613912);
    expect(roundTo(1e-7, 2)).toBe(0);
    expect(roundTo(1.23e-9, 6)).toBe(0);
    expect(roundTo(123456.789, 1)).toBe(123456.8);
    expect(roundTo(3e21, 2)).toBe(3e21);
  });

  it("refuses non-finite numbers", () => {
    expect(() => roundTo(NaN, 2)).toThrow();
  });
});
