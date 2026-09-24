import { hexToBytes } from "./hash";
import { jwkToPublicKey } from "./keys";
import type { Envelope } from "./envelope";
import { verifyRecordHashSignature } from "./sign";
import type { KeyRegistry } from "./verify";

/** Compact verification QR (PRD EXP-03, VER-06, TC-39; ARCHITECTURE §7.5).
 *
 *   FDTC1|<record_id>|<record_hash>|<key_id>|<signature base64url>
 *
 * ES256 signs SHA-256(payload), which is exactly record_hash, so a verifier
 * holding only this string and the public key can prove the device signed
 * that hash. Matching the hash to the printed fields still needs the JSON. */

export const QR_PREFIX = "FDTC1";

export interface QrPayload {
  record_id: string;
  record_hash: string;
  key_id: string;
  signature: string;
}

export function formatQrPayload(envelope: Envelope): string {
  const id = (envelope.record as { record_id?: unknown }).record_id;
  if (typeof id !== "string") throw new Error("record has no record_id");
  return [QR_PREFIX, id, envelope.record_hash, envelope.signature.key_id, envelope.signature.value].join("|");
}

export function parseQrPayload(text: string): QrPayload | null {
  const parts = text.trim().split("|");
  if (parts.length !== 5 || parts[0] !== QR_PREFIX) return null;
  const [, record_id, record_hash, key_id, signature] = parts;
  if (!/^[0-9a-f]{64}$/.test(record_hash) || !/^[A-Za-z0-9_-]{80,90}$/.test(signature) || !record_id || !key_id) return null;
  return { record_id, record_hash, key_id, signature };
}

export type QrVerdict = "SIGNATURE_VALID" | "SIGNATURE_INVALID" | "UNKNOWN_SIGNER" | "MALFORMED";

export interface QrReport {
  verdict: QrVerdict;
  payload: QrPayload | null;
  /** Where the public key came from. */
  key_source: "registry" | "genesis" | null;
  /** When a bundle was also supplied: does a record in it carry this exact hash? */
  matches_record: boolean | null;
  detail: string;
}

/** Verify a QR string. The key comes from the agency registry, or failing that
 * from a GENESIS record in an optional ledger export. */
export function verifyQrPayload(text: string, opts: { registry?: KeyRegistry | null; records?: Envelope[] } = {}): QrReport {
  const payload = parseQrPayload(text);
  if (!payload) {
    return { verdict: "MALFORMED", payload: null, key_source: null, matches_record: null, detail: "This is not an FDTC1 verification code." };
  }

  let key: Uint8Array | null = null;
  let key_source: QrReport["key_source"] = null;
  const entry = opts.registry?.keys.find((k) => k.key_id === payload.key_id && k.status !== "REVOKED");
  if (entry) {
    key = jwkToPublicKey(entry.jwk);
    key_source = "registry";
  } else {
    const genesis = opts.records?.find(
      (e) => (e.record as { record_type?: string; key_id?: string }).record_type === "GENESIS" && (e.record as { key_id?: string }).key_id === payload.key_id
    );
    const jwk = (genesis?.record as { public_key?: unknown } | undefined)?.public_key;
    if (jwk) {
      key = jwkToPublicKey(jwk as never);
      key_source = "genesis";
    }
  }

  const match = opts.records ? opts.records.some((e) => e.record_hash === payload.record_hash) : null;
  if (!key) {
    return {
      verdict: "UNKNOWN_SIGNER",
      payload,
      key_source: null,
      matches_record: match,
      detail: `Signing key ${payload.key_id} is not in the loaded registry${opts.records ? " or ledger export" : ""}.`,
    };
  }

  let ok = false;
  try {
    ok = verifyRecordHashSignature(hexToBytes(payload.record_hash), { alg: "ES256", key_id: payload.key_id, value: payload.signature }, key);
  } catch {
    ok = false;
  }
  return {
    verdict: ok ? "SIGNATURE_VALID" : "SIGNATURE_INVALID",
    payload,
    key_source,
    matches_record: match,
    detail: ok
      ? `Device key ${payload.key_id} signed record hash ${payload.record_hash.slice(0, 16)}… (key from ${key_source === "registry" ? "the agency registry" : "the device's GENESIS record"}).`
      : "The signature does not match this record hash and key — the code was altered or belongs to another record.",
  };
}
