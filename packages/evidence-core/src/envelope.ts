import { canonicalizeRecord, toUtf8Bytes } from "./canonical";
import { sha256Hex } from "./hash";
import { signPayload, verifyPayloadSignature, type Es256Signature } from "./sign";

export interface Envelope<TRecord = Record<string, unknown>> {
  fdtc_envelope: 1;
  record: TRecord;
  record_hash: string;
  signature: Es256Signature;
}

/** Builds the signed envelope for a record that already has seq/prev_hash set.
 * This is the app-side half of ARCHITECTURE §7.6 (the ledger owns seq/prev_hash
 * assignment inside its transaction; this function only hashes and signs). */
export function sealRecord<TRecord extends Record<string, unknown>>(
  record: TRecord,
  privateKey: Uint8Array,
  keyId: string
): Envelope<TRecord> {
  const payload = toUtf8Bytes(canonicalizeRecord(record));
  const record_hash = sha256Hex(payload);
  const signature = signPayload(payload, privateKey, keyId);
  return { fdtc_envelope: 1, record, record_hash, signature };
}

export type EnvelopeCheckFailure =
  | "MALFORMED_ENVELOPE"
  | "RECORD_ALTERED"
  | "SIGNATURE_INVALID";

export type EnvelopeCheckResult =
  | { ok: true }
  | { ok: false; reason: EnvelopeCheckFailure };

/** Recomputes record_hash and verifies the signature — the first three steps
 * of the verify.html flow in ARCHITECTURE §11, before any registry/image checks. */
export function checkEnvelope(envelope: Envelope, publicKey: Uint8Array): EnvelopeCheckResult {
  if (
    !envelope ||
    envelope.fdtc_envelope !== 1 ||
    typeof envelope.record !== "object" ||
    typeof envelope.record_hash !== "string" ||
    !envelope.signature
  ) {
    return { ok: false, reason: "MALFORMED_ENVELOPE" };
  }

  const payload = toUtf8Bytes(canonicalizeRecord(envelope.record));
  const recomputedHash = sha256Hex(payload);
  if (recomputedHash !== envelope.record_hash) {
    return { ok: false, reason: "RECORD_ALTERED" };
  }

  const signatureValid = verifyPayloadSignature(payload, envelope.signature, publicKey);
  if (!signatureValid) {
    return { ok: false, reason: "SIGNATURE_INVALID" };
  }

  return { ok: true };
}
