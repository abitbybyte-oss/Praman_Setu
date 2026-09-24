import {
  canonicalizeRecord,
  toUtf8Bytes,
  sha256Hex,
  verifyPayloadSignature,
  jwkToPublicKey,
  type Es256Signature,
  type EcJwk,
} from "@fdtc/evidence-core";

/** Reference DB shape (ARCHITECTURE §12). Every threshold the measurement
 * depends on lives here as signed data, never as code, so a changed cut-off
 * cannot be applied retroactively without detection. */

export interface CardPatch {
  id: "white" | "black" | "red" | "green" | "blue" | "gray";
  lab: [number, number, number];
}

export interface CardProfile {
  patches: CardPatch[];
  checks: {
    residual_mean_max: number;
    residual_max_max: number;
    neutral_ab_max: number;
    clip_frac_max: number;
  };
}

export interface KitClass {
  id: string;
  outcome: "PRELIMINARY_POSITIVE" | "PRELIMINARY_NEGATIVE";
  label: string;
  exemplars_lab: [number, number, number][];
  radius_de00: number;
}

export interface KitProfile {
  display_name: string;
  protocol: {
    required_s: number;
    max_s: number;
    demo_required_s: number;
    steps: string[];
  };
  classes: KitClass[];
}

export interface ReferenceDbBody {
  refdb_version: string;
  simulated: true;
  cards: Record<string, CardProfile>;
  kits: Record<string, KitProfile>;
  thresholds: Record<string, number>;
  quality_weights: Record<string, number>;
}

export interface SignedReferenceDb extends ReferenceDbBody {
  signature: Es256Signature;
}

/** The bytes that are hashed and signed: the whole DB with `signature` removed.
 * Used identically by the build script and the app's start-up check. */
export function referenceDbPayload(db: ReferenceDbBody | SignedReferenceDb): Uint8Array {
  const { signature: _ignored, ...body } = db as SignedReferenceDb;
  return toUtf8Bytes(canonicalizeRecord(body));
}

export function referenceDbHash(db: ReferenceDbBody | SignedReferenceDb): string {
  return sha256Hex(referenceDbPayload(db));
}

export type ReferenceDbCheck =
  | { ok: true; version: string; sha256: string }
  | { ok: false; reason: "MISSING_SIGNATURE" | "WRONG_KEY" | "SIGNATURE_INVALID" };

/** EVD-07: verified at start-up against the agency public key baked into the
 * app. A failure blocks testing — "Reference data failed verification". */
export function verifyReferenceDb(db: SignedReferenceDb, agencyPublicKeyJwk: EcJwk, expectedKeyId?: string): ReferenceDbCheck {
  if (!db?.signature?.value) return { ok: false, reason: "MISSING_SIGNATURE" };
  if (expectedKeyId && db.signature.key_id !== expectedKeyId) return { ok: false, reason: "WRONG_KEY" };

  const payload = referenceDbPayload(db);
  const publicKey = jwkToPublicKey(agencyPublicKeyJwk);
  if (!verifyPayloadSignature(payload, db.signature, publicKey)) {
    return { ok: false, reason: "SIGNATURE_INVALID" };
  }
  return { ok: true, version: db.refdb_version, sha256: sha256Hex(payload) };
}
