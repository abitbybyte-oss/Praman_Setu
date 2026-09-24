import { z } from "zod";

/** VOID record, schema fdtc.void/1 (ARCHITECTURE §7.1, ADR-011, PRD HIS-04).
 *
 * Replaces delete: the original TEST record stays in the ledger and still
 * verifies; the VOID is a new signed record that points at it by both
 * record_id and record_hash, so it cannot silently refer to another version. */

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

export const VOID_REASON_MIN = 10;

export const voidRecordSchema = z
  .object({
    schema: z.literal("fdtc.void/1"),
    record_type: z.literal("VOID"),
    record_id: z.string().uuid(),
    device_id: z.string().min(1),
    key_id: z.string().min(1),
    seq: z.number().int().min(1),
    prev_hash: hex64,
    created_at: iso,
    simulated: z.literal(true),
    operator: z
      .object({ badge_id: z.string().min(1), role: z.enum(["OFFICER", "SUPERVISOR"]), auth_method: z.enum(["PIN", "BIOMETRIC"]) })
      .strict(),
    target: z.object({ record_id: z.string().uuid(), record_hash: hex64 }).strict(),
    reason: z.string().trim().min(VOID_REASON_MIN, `a void reason of at least ${VOID_REASON_MIN} characters is required`),
    app: z.object({ version: z.string(), platform: z.string() }).strict(),
  })
  .strict();

export type VoidRecord = z.infer<typeof voidRecordSchema>;

export function parseVoidRecord(record: unknown): VoidRecord {
  const result = voidRecordSchema.safeParse(record);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".") || "(record)"}: ${i.message}`);
    throw new Error(`VOID record failed schema validation:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}
