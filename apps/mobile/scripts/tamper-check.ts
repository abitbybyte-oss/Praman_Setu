/** Tamper suite (PRD TC-33..TC-38) against real fdtc.test/1 records built by
 * the app's own record builder, plus demo files for verify.html.
 *
 *   npx tsx scripts/tamper-check.ts
 *
 * Writes tools/demo/tamper/dist/: an untouched export + photo, and tampered
 * copies, for the live "edit one byte → FAILED" demo. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import {
  buildGenesisRecord,
  buildLedgerExport,
  generateKeyPair,
  parseTestRecord,
  publicKeyFromPrivateKey,
  publicKeyToJwk,
  sealRecord,
  sha256Hex,
  verifyBundle,
  type Envelope,
  type KeyRegistry,
  type VerifyReport,
} from '@fdtc/evidence-core';

import { MIGRATION_1 } from '../src/adapters/schema';
import { buildTestRecord } from '../src/services/recordBuilder';
import { DEFAULT_CARD, kit, loadRefdb } from '../src/services/refdb';
import type { Draft } from '../src/workflow/draft';

let failures = 0;
function expect(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}
const check = (r: VerifyReport, id: string) => r.checks.find((c) => c.id === id);

// ---- TC-33: the app's ledger schema aborts UPDATE and DELETE -------------------------------
{
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATION_1);
  db.prepare(
    "INSERT INTO ledger (seq, record_id, record_type, payload, prev_hash, record_hash, signature, key_id, created_at) VALUES (0,'r0','GENESIS','{}',NULL,'h0','s','k','t')"
  ).run();
  const aborted = (sql: string) => {
    try {
      db.exec(sql);
      return false;
    } catch (e) {
      return String(e).includes('append-only');
    }
  };
  expect('TC-33 UPDATE on ledger aborted by trigger', aborted("UPDATE ledger SET payload = 'x' WHERE seq = 0"));
  expect('TC-33 DELETE on ledger aborted by trigger', aborted('DELETE FROM ledger WHERE seq = 0'));
}

// ---- Build a real device chain: GENESIS + 3 TEST records ----------------------------------
const refdb = loadRefdb();
const deviceKey = generateKeyPair().privateKey;
const devicePub = publicKeyFromPrivateKey(deviceKey);
const genesis = buildGenesisRecord({
  publicKey: devicePub,
  recordId: '22222222-2222-4222-8222-222222222222',
  createdAt: '2026-09-24T09:00:00.000Z',
  appVersion: '0.1.0',
  platform: 'node',
});
const keyId = genesis.key_id;
const chain: Envelope[] = [sealRecord(genesis as never, deviceKey, keyId) as Envelope];

// Stand-in for the original camera JPEG: only its exact bytes matter to the verifier.
const photo = new TextEncoder().encode(`\xff\xd8\xff\xe0 FDTC demo photo ${Date.now()} \xff\xd9`);
const photoSha = sha256Hex(photo);

function addTest(caseId: string, sha: string) {
  const d: Draft = {
    recordId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    kitType: 'SIM-A',
    caseId,
    witness: null,
    captures: [{ n: 1, uri: 'x', sha256: sha, bytes: 2500000, taken_at: new Date().toISOString(), accepted: true, reject_reasons: [], laplacian_variance: 250 }],
    corners: null,
    cornersSnapped: [],
    card: null,
    roi: null,
    sample: null,
    endedEarly: { kind: 'CARD_INVALID', reasons: ['CARD_CALIBRATION_FAILED'] },
  };
  const rec = buildTestRecord(
    {
      draft: d,
      operator: { badge_id: '1001', name: 'Demo Officer', role: 'OFFICER' },
      ctx: {
        location: null,
        clock: { device_time: new Date().toISOString(), gnss_time: null, skew_s: null, monotonic_ms: 1 },
        integrity: { rooted: false, mock_location: null, clock_skew: null, location_unavailable: true },
      },
      identity: { deviceId: genesis.device_id, keyId },
      refdb: { version: refdb.version, sha256: refdb.sha256 },
      profile: kit('SIM-A'),
      cardVersion: DEFAULT_CARD,
      wc: { width: 1200, height: 1600, scale: 2.04, origWidth: 2448, origHeight: 3264 },
      app: { version: '0.1.0', platform: 'node' },
      createdAt: new Date().toISOString(),
    },
    chain.length,
    chain[chain.length - 1].record_hash
  );
  parseTestRecord(rec);
  chain.push(sealRecord(rec as never, deviceKey, keyId) as Envelope);
}
addTest('FIR-DEMO-1', photoSha);
addTest('FIR-DEMO-2', sha256Hex(new TextEncoder().encode('another photo')));
addTest('FIR-DEMO-3', sha256Hex(new TextEncoder().encode('third photo')));

const registry: KeyRegistry = {
  generated_at: new Date().toISOString(),
  keys: [{ key_id: keyId, device_id: genesis.device_id, jwk: publicKeyToJwk(devicePub), status: 'ACTIVE', registered_at: '2026-09-24T09:05:00.000Z' }],
};
const exported = buildLedgerExport(chain, genesis.device_id);
const clone = () => JSON.parse(JSON.stringify(exported));

// ---- TC-34: untouched export verifies ------------------------------------------------------
{
  const r = verifyBundle({ bundle: clone(), registry, images: [{ name: 'photo.jpg', bytes: photo }] });
  expect('TC-34 unmodified export + photo + registry', r.verdict === 'VERIFIED', r.verdict);
}

// ---- TC-35: change the outcome in the JSON -------------------------------------------------
const alteredOutcome = clone();
alteredOutcome.records[1].record.classification.outcome = 'PRELIMINARY_NEGATIVE';
{
  const r = verifyBundle({ bundle: alteredOutcome, registry });
  expect('TC-35 outcome edited', r.verdict === 'FAILED' && check(r, 'RECORD_HASH')?.status === 'FAIL', check(r, 'RECORD_HASH')?.detail);
}
{
  // A single character anywhere in the record is enough.
  const b = clone();
  b.records[2].record.case.case_id = 'FIR-DEMO-9';
  const r = verifyBundle({ bundle: b, registry });
  expect('TC-35 one character of the case ID edited', r.verdict === 'FAILED');
}

// ---- TC-36: flip one byte of the image -----------------------------------------------------
const flipped = photo.slice();
flipped[10] ^= 0x01;
{
  const r = verifyBundle({ bundle: clone(), registry, images: [{ name: 'photo.jpg', bytes: flipped }] });
  expect('TC-36 one image byte flipped', r.verdict === 'FAILED' && check(r, 'IMAGE')?.status === 'FAIL', check(r, 'IMAGE')?.detail);
}

// ---- TC-37: record re-signed with a key not in the registry -------------------------------
const forged = clone();
{
  const rogue = generateKeyPair().privateKey;
  forged.records[1] = sealRecord(forged.records[1].record, rogue, keyId);
  const r = verifyBundle({ bundle: forged, registry });
  expect('TC-37 re-signed with a rogue key', r.verdict === 'FAILED', check(r, 'SIGNATURE')?.detail);
}
{
  // An attacker who also invents a new identity (own key_id) is caught by the registry.
  const rogue = generateKeyPair().privateKey;
  const rogueGenesis = buildGenesisRecord({ publicKey: publicKeyFromPrivateKey(rogue), recordId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-09-24T09:00:00.000Z', appVersion: '0.1.0', platform: 'node' });
  const bundle = buildLedgerExport([sealRecord(rogueGenesis as never, rogue, rogueGenesis.key_id) as Envelope], rogueGenesis.device_id);
  const r = verifyBundle({ bundle, registry });
  expect('TC-37 self-consistent chain from an unregistered key', r.verdict === 'FAILED' && check(r, 'SIGNER')?.status === 'FAIL', check(r, 'SIGNER')?.detail);
}

// ---- TC-38: middle record removed; also reordering -----------------------------------------
const removed = clone();
removed.records.splice(2, 1);
{
  const r = verifyBundle({ bundle: removed, registry });
  expect('TC-38 middle record removed', r.verdict === 'FAILED' && check(r, 'CHAIN')?.status === 'FAIL', check(r, 'CHAIN')?.detail);
}
{
  const b = clone();
  [b.records[1], b.records[2]] = [b.records[2], b.records[1]];
  const r = verifyBundle({ bundle: b, registry });
  // File order carries no meaning: the verifier orders by seq, so a shuffled file still verifies.
  expect('records shuffled in the file still verify (ordered by seq)', r.verdict !== 'FAILED', r.verdict);
}

// ---- Demo files for verify.html ------------------------------------------------------------
const out = join(__dirname, '../../../tools/demo/tamper/dist');
mkdirSync(out, { recursive: true });
const json = (name: string, v: unknown) => writeFileSync(join(out, name), JSON.stringify(v, null, 2) + '\n');
json('1-original-ledger.json', exported);
writeFileSync(join(out, '1-original-photo.jpg'), photo);
json('2-tampered-outcome.json', alteredOutcome);
writeFileSync(join(out, '3-tampered-photo.jpg'), flipped);
json('4-forged-signature.json', forged);
json('5-record-deleted.json', removed);
json('registry.json', registry);
writeFileSync(
  join(out, 'README.txt'),
  [
    'SIMULATED — NOT A DRUG TEST. Tamper demo files for verify.html.',
    'Load registry.json in section 2, then:',
    '  1-original-ledger.json + 1-original-photo.jpg  -> VERIFIED',
    '  2-tampered-outcome.json                         -> FAILED: record content altered',
    '  1-original-ledger.json + 3-tampered-photo.jpg   -> FAILED: photograph altered',
    '  4-forged-signature.json                         -> FAILED: signature invalid',
    '  5-record-deleted.json                           -> FAILED: sequence broken',
    '',
  ].join('\n')
);
console.log(`\nDemo files written to ${out}`);

console.log(failures === 0 ? '\nTAMPER SUITE OK' : `\nTAMPER SUITE: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
