import { z } from "zod";

/** TEST record, schema fdtc.test/1 (ARCHITECTURE §7.3, §7.4).
 *
 * One schema, used by the app before signing and available to the verifier and
 * server. `.strict()` everywhere: an unexpected field is a bug, not data.
 * Numbers must be finite and already rounded per §7.4 — see roundTo(). */

/** Round half away from zero to `dp` decimal places, and normalise -0 to 0.
 *
 * Works on the shortest decimal representation (via exponent strings), so
 * 1.005 → 1.01 rather than 1.00 from binary 1.00499…; that representation is
 * fixed by the ECMAScript spec, so every engine produces the same bytes. */
export function roundTo(value: number, dp: number): number {
  if (!Number.isFinite(value)) throw new Error(`cannot round non-finite value ${value}`);
  const abs = Math.abs(value);
  // Tiny or huge values already print in exponent form; they are far from a
  // rounding tie at the precisions we use, so plain scaling is exact enough.
  const scaled = String(abs).includes("e")
    ? Math.round(abs * Math.pow(10, dp)) / Math.pow(10, dp)
    : Number(`${Math.round(Number(`${abs}e${dp}`))}e-${dp}`);
  const r = Math.sign(value) * scaled;
  return r === 0 ? 0 : r;
}

const num = z.number().finite();
const int = z.number().int();
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const lab = z.tuple([num, num, num]);
const xy = z.tuple([num, num]);

export const OUTCOMES = ["PRELIMINARY_POSITIVE", "PRELIMINARY_NEGATIVE", "INCONCLUSIVE"] as const;
export const INCONCLUSIVE_REASONS = [
  "IMAGE_BLURRY",
  "POOR_LIGHTING",
  "EXCESSIVE_GLARE",
  "REACTION_AREA_TOO_SMALL",
  "CARD_CALIBRATION_FAILED",
  "MULTIPLE_COLOURS",
  "MEASUREMENT_UNCERTAINTY_HIGH",
  "OUTSIDE_REACTION_WINDOW",
  "ABANDONED",
  "OUTSIDE_REFERENCE_RANGE",
  "REPEAT_ALSO_INCONCLUSIVE",
] as const;

const capture = z
  .object({
    n: int.min(1),
    sha256: hex64,
    bytes: int.min(1),
    taken_at: iso,
    accepted: z.boolean(),
    reject_reasons: z.array(z.string()),
    quality_score: int.min(0).max(100).nullable(),
    laplacian_variance: num.nullable(),
  })
  .strict();

const corner = xy;

export const testRecordSchema = z
  .object({
    schema: z.literal("fdtc.test/1"),
    record_type: z.literal("TEST"),
    record_id: z.string().uuid(),
    device_id: z.string().min(1),
    key_id: z.string().min(1),
    seq: int.min(1),
    prev_hash: hex64,
    created_at: iso,
    simulated: z.literal(true),
    source: z.enum(["CAMERA", "FIXTURE"]),
    operator: z
      .object({ badge_id: z.string().min(1), role: z.enum(["OFFICER", "SUPERVISOR"]), auth_method: z.enum(["PIN", "BIOMETRIC"]) })
      .strict(),
    case: z.object({ case_id: z.string().nullable(), witness_badge_id: z.string().nullable() }).strict(),
    kit: z
      .object({
        kit_type: z.string().min(1),
        display_name: z.string(),
        entry: z.enum(["MANUAL", "QR"]),
        kit_id: z.string().nullable(),
        manufacturer: z.string().nullable(),
        batch: z.string().nullable(),
        mfg_date: z.string().nullable(),
        expiry_date: z.string().nullable(),
        status: z.enum(["VALID", "EXPIRED", "NOT_YET_VALID", "UNRECOGNISED", "NOT_CHECKED"]),
        /** SHA-256 of the exact scanned QR payload (KIT-03). */
        qr_sha256: hex64.nullable(),
      })
      .strict(),
    timing: z
      .object({
        timer: z.enum(["NONE", "KIT_PROTOCOL", "DEMO_PROTOCOL"]),
        timer_start: iso.nullable(),
        capture_time: iso.nullable(),
        elapsed_s: num.nullable(),
        required_s: num,
        max_s: num,
        in_window: z.boolean().nullable(),
      })
      .strict(),
    captures: z.array(capture),
    evidence_image: z
      .object({ n: int.min(1), sha256: hex64, mime: z.literal("image/jpeg"), bytes: int.min(1), width: int.min(1), height: int.min(1) })
      .strict()
      .nullable(),
    working: z.object({ width: int.min(1), height: int.min(1), scale: num }).strict().nullable(),
    calibration: z
      .object({
        card_version: z.string(),
        // tone-affine3x4: tone_gamma is applied to linear RGB before the matrix; affine3x4 records predate it.
        model: z.enum(["affine3x4", "tone-affine3x4"]),
        tone_gamma: num.optional(),
        locate: z.literal("corner-taps-homography/1"),
        corners: z.object({ top_left: corner, top_right: corner, bottom_right: corner, bottom_left: corner }).strict(),
        corners_snapped: z.array(z.boolean()).length(4),
        patches: z.record(z.object({ xy, rgb: lab, mad: num, window: int }).strict()),
        matrix: z.array(num),
        residual_de00_mean: num.nullable(),
        residual_de00_max: num.nullable(),
        card_status: z.enum(["VALID", "INVALID"]),
        failed_checks: z.array(z.string()),
      })
      .strict()
      .nullable(),
    measurement: z
      .object({
        roi: z.object({ x: num, y: num, r: num }).strict(),
        lab,
        spread_de00_p90: num,
        area_px: int,
        glare_fraction: num,
        pale_exempt: z.boolean(),
      })
      .strict()
      .nullable(),
    quality: z
      .object({
        score: int.min(0).max(100),
        band: z.enum(["GOOD", "FAIR", "POOR"]),
        components: z.record(num),
        reasons: z.array(z.string()),
        hard_gates: z.array(z.string()),
      })
      .strict()
      .nullable(),
    classification: z
      .object({
        algorithm: z.literal("nearest-class-de00/1"),
        outcome: z.enum(OUTCOMES),
        class_id: z.string().nullable(),
        class_label: z.string().nullable(),
        d1_de00: num.nullable(),
        d2_de00: num.nullable(),
        confidence: num.min(0).max(1),
        uncertainty_de00: num,
        inconclusive_reasons: z.array(z.enum(INCONCLUSIVE_REASONS)),
        recommended_action: z.enum(["RETAKE_PHOTO", "REPEAT_TEST", "PRESERVE_FOR_LAB"]).nullable(),
      })
      .strict(),
    location: z
      .object({
        lat: num,
        lon: num,
        accuracy_m: num.nullable(),
        fix_time: iso,
        provider: z.string(),
        mocked: z.boolean().nullable(),
      })
      .strict()
      .nullable(),
    clock: z
      .object({ device_time: iso, gnss_time: iso.nullable(), skew_s: num.nullable(), monotonic_ms: int })
      .strict(),
    integrity: z
      .object({
        rooted: z.boolean().nullable(),
        mock_location: z.boolean().nullable(),
        clock_skew: z.boolean().nullable(),
        location_unavailable: z.boolean(),
      })
      .strict(),
    reference_db: z.object({ version: z.string(), sha256: hex64 }).strict(),
    retest_of: z.object({ record_id: z.string().uuid(), record_hash: hex64 }).strict().nullable(),
    retake_count: int.min(0),
    ended_early: z.enum(["CARD_INVALID", "HARD_GATE", "ABANDONED"]).nullable(),
    app: z.object({ version: z.string(), platform: z.string() }).strict(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const c = r.classification;
    if (c.outcome === "INCONCLUSIVE" && c.inconclusive_reasons.length === 0)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "INCONCLUSIVE needs at least one reason" });
    if (c.outcome !== "INCONCLUSIVE" && c.inconclusive_reasons.length > 0)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a preliminary outcome cannot carry inconclusive reasons" });
    if (c.outcome !== "INCONCLUSIVE" && (!r.measurement || r.calibration?.card_status !== "VALID"))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a preliminary outcome needs a measurement on a VALID card" });
    if (r.evidence_image && !r.captures.some((k) => k.sha256 === r.evidence_image!.sha256 && k.accepted))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "evidence_image must be an accepted capture" });
    if (r.kit.entry === "QR" && (r.kit.status !== "VALID" || !r.kit.qr_sha256))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "only a VALID scanned kit can be used (KIT-05)" });
    if (r.kit.entry === "MANUAL" && r.kit.status !== "NOT_CHECKED")
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a manually selected kit has status NOT_CHECKED" });
    if (r.timing.timer !== "NONE" && !r.timing.timer_start)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a timed test needs timer_start" });
    if (r.timing.in_window === false && !c.inconclusive_reasons.includes("OUTSIDE_REACTION_WINDOW"))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a capture outside the reaction window must be Inconclusive (TMR-05)" });
    if (r.retake_count !== Math.max(0, r.captures.length - 1))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "retake_count must equal captures - 1" });
  });

export type TestRecord = z.infer<typeof testRecordSchema>;

/** Validate a TEST record; throws with every problem listed. */
export function parseTestRecord(record: unknown): TestRecord {
  const result = testRecordSchema.safeParse(record);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".") || "(record)"}: ${i.message}`);
    throw new Error(`TEST record failed schema validation:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}
