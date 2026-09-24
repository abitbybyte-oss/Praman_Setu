import { describe, expect, it } from "vitest";
import {
  buildGenesisRecord,
  formatQrPayload,
  generateKeyPair,
  parseQrPayload,
  publicKeyFromPrivateKey,
  publicKeyToJwk,
  sealRecord,
  verifyQrPayload,
  type Envelope,
} from "../index";

const priv = generateKeyPair().privateKey;
const pub = publicKeyFromPrivateKey(priv);
const genesis = buildGenesisRecord({ publicKey: pub, recordId: "11111111-1111-4111-8111-111111111111", createdAt: "2026-09-24T10:00:00.000Z", appVersion: "t", platform: "t" });
const g = sealRecord(genesis as never, priv, genesis.key_id) as Envelope;
const test = sealRecord({ record_type: "TEST", record_id: "22222222-2222-4222-8222-222222222222", seq: 1, prev_hash: g.record_hash, outcome: "X" }, priv, genesis.key_id) as Envelope;
const registry = { keys: [{ key_id: genesis.key_id, jwk: publicKeyToJwk(pub), status: "ACTIVE" }] };
const qr = formatQrPayload(test);

describe("TC-39 verify from the PDF QR string alone", () => {
  it("formats FDTC1|record_id|record_hash|key_id|signature and parses back", () => {
    expect(qr.split("|")).toHaveLength(5);
    expect(parseQrPayload(qr)).toEqual({ record_id: test.record.record_id, record_hash: test.record_hash, key_id: genesis.key_id, signature: test.signature.value });
    expect(qr.length).toBeLessThan(260); // fits a small QR code
  });

  it("signature valid with the key from the registry", () => {
    const r = verifyQrPayload(qr, { registry });
    expect(r.verdict).toBe("SIGNATURE_VALID");
    expect(r.key_source).toBe("registry");
  });

  it("signature valid with the key from a GENESIS record, and matches the record in the export", () => {
    const r = verifyQrPayload(qr, { records: [g, test] });
    expect(r.verdict).toBe("SIGNATURE_VALID");
    expect(r.key_source).toBe("genesis");
    expect(r.matches_record).toBe(true);
  });

  it("an altered hash or signature fails", () => {
    const parts = qr.split("|");
    const h = parts[2];
    const badHash = [parts[0], parts[1], (h[0] === "a" ? "b" : "a") + h.slice(1), parts[3], parts[4]].join("|");
    expect(verifyQrPayload(badHash, { registry }).verdict).toBe("SIGNATURE_INVALID");
    const s = parts[4];
    const badSig = [...parts.slice(0, 4), s.slice(0, 10) + (s[10] === "A" ? "B" : "A") + s.slice(11)].join("|");
    expect(verifyQrPayload(badSig, { registry }).verdict).toBe("SIGNATURE_INVALID");
  });

  it("an unknown key or junk text is reported, not crashed on", () => {
    expect(verifyQrPayload(qr, {}).verdict).toBe("UNKNOWN_SIGNER");
    for (const t of ["", "hello", "FDTC1|a|b|c|d", qr + "|extra"]) expect(verifyQrPayload(t, { registry }).verdict).toBe("MALFORMED");
  });
});
