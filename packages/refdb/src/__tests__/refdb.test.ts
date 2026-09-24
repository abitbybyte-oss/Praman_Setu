import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EcJwk } from "@fdtc/evidence-core";

import { referenceDbHash, verifyReferenceDb, type SignedReferenceDb } from "../index";

// The exact files the mobile app bundles and verifies at start-up (EVD-07).
const appDir = new URL("../../../../apps/mobile/src/refdb/", import.meta.url);
const bundled = JSON.parse(readFileSync(new URL("refdb.signed.json", appDir), "utf8")) as SignedReferenceDb;
const agency = JSON.parse(readFileSync(new URL("agency-refdb.pub.json", appDir), "utf8")) as { key_id: string; jwk: EcJwk };
const copy = (): SignedReferenceDb => JSON.parse(JSON.stringify(bundled));

describe("EVD-07 signed Reference DB", () => {
  it("the DB bundled in the app verifies against the bundled agency key", () => {
    const check = verifyReferenceDb(bundled, agency.jwk, agency.key_id);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.sha256).toBe(referenceDbHash(bundled));
  });

  it("a changed threshold is rejected", () => {
    const db = copy();
    db.thresholds.conf_min = 0.05;
    expect(verifyReferenceDb(db, agency.jwk, agency.key_id)).toEqual({ ok: false, reason: "SIGNATURE_INVALID" });
  });

  it("a moved class exemplar is rejected", () => {
    const db = copy();
    db.kits["SIM-A"].classes[0].exemplars_lab[0][1] += 0.5;
    expect(verifyReferenceDb(db, agency.jwk, agency.key_id)).toEqual({ ok: false, reason: "SIGNATURE_INVALID" });
  });

  it("a changed card patch colour or layout is rejected", () => {
    const a = copy();
    a.cards["FDTC-CARD-1"].patches[2].lab[0] += 1;
    expect(verifyReferenceDb(a, agency.jwk, agency.key_id).ok).toBe(false);
    const b = copy();
    b.cards["FDTC-CARD-1"].layout.patches_mm.red.x += 1;
    expect(verifyReferenceDb(b, agency.jwk, agency.key_id).ok).toBe(false);
  });

  it("a DB signed by another key, or unsigned, is rejected", () => {
    expect(verifyReferenceDb(bundled, agency.jwk, "someone_else")).toEqual({ ok: false, reason: "WRONG_KEY" });
    const unsigned = copy() as Partial<SignedReferenceDb>;
    delete unsigned.signature;
    expect(verifyReferenceDb(unsigned as SignedReferenceDb, agency.jwk).ok).toBe(false);
  });

  it("the hash changes with any content change (records carry it)", () => {
    const db = copy();
    db.refdb_version = "2026.09-demo-2";
    expect(referenceDbHash(db)).not.toBe(referenceDbHash(bundled));
  });
});

describe("DEMO-02 simulated profiles only", () => {
  it("is marked simulated and every class label says Simulated", () => {
    expect(bundled.simulated).toBe(true);
    for (const kit of Object.values(bundled.kits)) {
      for (const c of kit.classes) expect(c.label).toMatch(/^Simulated /);
    }
  });

  it("names no substance anywhere", () => {
    const text = JSON.stringify(bundled).toLowerCase();
    const names = ["cocaine", "heroin", "cannabis", "marijuana", "thc", "amphetamine", "methamphetamine", "mdma", "ecstasy", "opium", "morphine", "ketamine", "lsd", "fentanyl", "ganja", "charas", "smack", "brown sugar"];
    for (const n of names) expect(text.includes(n), n).toBe(false);
  });
});
