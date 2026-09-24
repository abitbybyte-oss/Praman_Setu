import { describe, expect, it } from "vitest";
import { createPublicKey, verify as nodeVerify } from "node:crypto";
import {
  canonicalizeRecord,
  toUtf8Bytes,
  sha256Hex,
  generateKeyPair,
  keyIdFromPublicKey,
  sealRecord,
  checkEnvelope,
  verifyChain,
  type ChainLedgerRow,
} from "../index";

// Phase 0 exit criteria (ARCHITECTURE §12): "A photo taken on the phone is
// hashed and signed, and the signature verifies in verify.html and in Node
// crypto.verify." This suite is the Node half of that check, run against a
// plain record instead of a real photo.

describe("canonicalisation", () => {
  it("produces the same bytes regardless of key order (RFC 8785)", () => {
    const a = canonicalizeRecord({ b: 1, a: 2 });
    const b = canonicalizeRecord({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });
});

describe("sign + verify round trip", () => {
  const { privateKey, publicKey } = generateKeyPair();
  const keyId = keyIdFromPublicKey(publicKey);
  const record = { schema: "fdtc.test/1", seq: 0, prev_hash: null, classification: { outcome: "PRELIMINARY_POSITIVE" } };

  it("verifies with our own evidence-core implementation", () => {
    const envelope = sealRecord(record, privateKey, keyId);
    const result = checkEnvelope(envelope, publicKey);
    expect(result.ok).toBe(true);
  });

  it("FAILS when a byte of the record is altered after signing", () => {
    const envelope = sealRecord(record, privateKey, keyId);
    const tampered = { ...envelope, record: { ...envelope.record, classification: { outcome: "PRELIMINARY_NEGATIVE" } } };
    const result = checkEnvelope(tampered as typeof envelope, publicKey);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("RECORD_ALTERED");
  });

  it("verifies independently with Node's built-in crypto.verify (dsaEncoding: ieee-p1363)", () => {
    const envelope = sealRecord(record, privateKey, keyId);
    const payload = toUtf8Bytes(canonicalizeRecord(envelope.record));

    // record_hash must equal our own sha256Hex(payload) too.
    expect(envelope.record_hash).toBe(sha256Hex(payload));

    const x = Buffer.from(publicKey.slice(1, 33)).toString("base64url");
    const y = Buffer.from(publicKey.slice(33, 65)).toString("base64url");
    const nodeKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x, y }, format: "jwk" });

    const signatureBytes = Buffer.from(envelope.signature.value, "base64url");
    const isValid = nodeVerify("sha256", Buffer.from(payload), { key: nodeKey, dsaEncoding: "ieee-p1363" }, signatureBytes);
    expect(isValid).toBe(true);
  });
});

describe("chain verification", () => {
  it("detects a removed record (gap) in the middle of the chain", () => {
    const { privateKey, publicKey } = generateKeyPair();
    const keyId = keyIdFromPublicKey(publicKey);

    const rows: ChainLedgerRow[] = [];
    let prevHash: string | null = null;
    for (let seq = 0; seq < 3; seq++) {
      const envelope = sealRecord({ seq, prev_hash: prevHash }, privateKey, keyId);
      rows.push({ seq, prev_hash: prevHash, envelope, publicKey });
      prevHash = envelope.record_hash;
    }

    const withGap = [rows[0], rows[2]];
    const result = verifyChain(withGap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe("SEQ_GAP");
    }
  });

  it("passes for an intact chain", () => {
    const { privateKey, publicKey } = generateKeyPair();
    const keyId = keyIdFromPublicKey(publicKey);

    const rows: ChainLedgerRow[] = [];
    let prevHash: string | null = null;
    for (let seq = 0; seq < 3; seq++) {
      const envelope = sealRecord({ seq, prev_hash: prevHash }, privateKey, keyId);
      rows.push({ seq, prev_hash: prevHash, envelope, publicKey });
      prevHash = envelope.record_hash;
    }

    expect(verifyChain(rows).ok).toBe(true);
  });
});
