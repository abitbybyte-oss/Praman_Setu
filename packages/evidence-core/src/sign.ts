import { p256 } from "@noble/curves/nist.js";
import { bytesToBase64Url, base64UrlToBytes } from "./base64url";

export interface Es256Signature {
  alg: "ES256";
  key_id: string;
  value: string; // base64url(r‖s), 64 bytes
}

/** ES256 = ECDSA P-256 over SHA-256(payload), encoded as 64-byte r‖s (IEEE
 * P1363), base64url (ARCHITECTURE §7.5 / ADR-004). `prehash: true` (the
 * default) makes @noble/curves hash the payload with SHA-256 internally,
 * which is exactly SHA-256(payload) — the same digest as record_hash. Cross-
 * verified against Node's built-in crypto.verify in the test suite. */
export function signPayload(payload: Uint8Array, privateKey: Uint8Array, keyId: string): Es256Signature {
  const signature = p256.sign(payload, privateKey); // compact format (64-byte r‖s), prehash: true by default
  return { alg: "ES256", key_id: keyId, value: bytesToBase64Url(signature) };
}

export function verifyPayloadSignature(
  payload: Uint8Array,
  signature: Es256Signature,
  publicKey: Uint8Array
): boolean {
  const sigBytes = base64UrlToBytes(signature.value);
  return p256.verify(sigBytes, payload, publicKey);
}

/** Verify from only (record_hash, signature, public key) — e.g. from a PDF QR
 * string — with no access to the full JSON record. `prehash: false` treats
 * recordHash as the already-hashed digest instead of hashing it again. */
export function verifyRecordHashSignature(
  recordHashBytes: Uint8Array,
  signature: Es256Signature,
  publicKey: Uint8Array
): boolean {
  const sigBytes = base64UrlToBytes(signature.value);
  return p256.verify(sigBytes, recordHashBytes, publicKey, { prehash: false });
}
