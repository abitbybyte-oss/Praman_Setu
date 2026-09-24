import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createPublicKey, verify as nodeVerify } from "node:crypto";
import {
  base64UrlToBytes,
  canonicalizeRecord,
  checkEnvelope,
  jwkToPublicKey,
  sha256Hex,
  toUtf8Bytes,
  verifyBundle,
  type EcJwk,
  type Envelope,
  type KeyRegistry,
} from "../index";

/** Guards the wire format against accidental change. ARCHITECTURE §7.5 warns
 * that a native signer would emit DER instead of r‖s; these pinned vectors are
 * what catches that, along with any drift in canonicalisation or hashing. */

interface Vector {
  name: string;
  jcs: string;
  record_hash: string;
  signature_b64url: string;
  envelope: Envelope;
}

const fixture = JSON.parse(
  readFileSync(new URL("../../../../tools/fixtures/crypto/es256-vectors.json", import.meta.url), "utf8")
) as {
  public_key_jwk: EcJwk;
  key_id: string;
  device_id: string;
  vectors: Vector[];
};

const publicKey = jwkToPublicKey(fixture.public_key_jwk);

describe.each(fixture.vectors)("pinned vector: $name", (vector) => {
  it("canonicalises to exactly the recorded bytes", () => {
    expect(canonicalizeRecord(vector.envelope.record)).toBe(vector.jcs);
  });

  it("hashes to exactly the recorded record_hash", () => {
    expect(sha256Hex(toUtf8Bytes(vector.jcs))).toBe(vector.record_hash);
    expect(vector.envelope.record_hash).toBe(vector.record_hash);
  });

  it("reproduces the recorded signature (ECDSA here is deterministic, RFC 6979)", () => {
    expect(vector.envelope.signature.value).toBe(vector.signature_b64url);
    expect(base64UrlToBytes(vector.signature_b64url)).toHaveLength(64);
  });

  it("verifies with evidence-core", () => {
    expect(checkEnvelope(vector.envelope, publicKey)).toEqual({ ok: true });
  });

  it("verifies with Node's crypto.verify as an independent implementation", () => {
    const key = createPublicKey({ key: fixture.public_key_jwk as never, format: "jwk" });
    const valid = nodeVerify(
      "sha256",
      toUtf8Bytes(vector.jcs),
      { key, dsaEncoding: "ieee-p1363" },
      base64UrlToBytes(vector.signature_b64url)
    );
    expect(valid).toBe(true);
  });
});

describe("verifyBundle over a ledger export", () => {
  const records = fixture.vectors.map((vector) => vector.envelope);
  const bundle = { fdtc_export: 1 as const, kind: "LEDGER" as const, device_id: fixture.device_id, records };

  const registry: KeyRegistry = {
    generated_at: "2026-09-22T11:00:00.000Z",
    keys: [
      {
        key_id: fixture.key_id,
        device_id: fixture.device_id,
        jwk: fixture.public_key_jwk,
        status: "ACTIVE",
        registered_at: "2026-09-22T10:05:00.000Z",
      },
    ],
  };

  it("is VERIFIED when the registry vouches for the signer", () => {
    const report = verifyBundle({ bundle, registry });
    const failed = report.checks.filter((check) => check.status === "FAIL");
    expect(failed).toEqual([]);
    // The image check is skipped because no image file was supplied.
    expect(report.verdict).toBe("VERIFIED_WITH_WARNINGS");
    expect(report.checks.find((c) => c.id === "SIGNER")?.status).toBe("PASS");
    expect(report.checks.find((c) => c.id === "SIGNATURE")?.status).toBe("PASS");
    expect(report.checks.find((c) => c.id === "CHAIN")?.status).toBe("PASS");
  });

  it("still verifies the signature from GENESIS alone, but warns about the signer", () => {
    const report = verifyBundle({ bundle });
    expect(report.checks.find((c) => c.id === "SIGNATURE")?.status).toBe("PASS");
    expect(report.checks.find((c) => c.id === "SIGNER")?.status).toBe("WARN");
    expect(report.verdict).toBe("VERIFIED_WITH_WARNINGS");
  });

  it("FAILS when a record is altered after signing", () => {
    const tampered = structuredClone(bundle) as typeof bundle;
    (tampered.records[1].record as Record<string, unknown>).source = "CAMERA";
    const report = verifyBundle({ bundle: tampered, registry });
    expect(report.verdict).toBe("FAILED");
    expect(report.checks.find((c) => c.id === "RECORD_HASH")?.status).toBe("FAIL");
  });

  it("FAILS when a record is removed from the middle of the chain", () => {
    const truncated = { ...bundle, records: [records[0]] };
    const report = verifyBundle({ bundle: { ...truncated, records: [records[1]] }, registry });
    expect(report.checks.find((c) => c.id === "CHAIN")?.status).not.toBe("PASS");
  });

  it("FAILS when an unknown key signed the record", () => {
    const foreign: KeyRegistry = { keys: [{ ...registry.keys[0], key_id: "k_somethingElse" }] };
    const report = verifyBundle({ bundle, registry: foreign });
    expect(report.verdict).toBe("FAILED");
    expect(report.checks.find((c) => c.id === "SIGNER")?.status).toBe("FAIL");
  });

  it("FAILS when the supplied image is not the one that was photographed", () => {
    const report = verifyBundle({
      bundle,
      registry,
      images: [{ name: "swapped.jpg", bytes: new Uint8Array([1, 2, 3]) }],
    });
    expect(report.verdict).toBe("FAILED");
    expect(report.checks.find((c) => c.id === "IMAGE")?.status).toBe("FAIL");
  });
});
