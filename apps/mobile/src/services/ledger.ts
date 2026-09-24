import Constants from 'expo-constants';
import * as ExpoCrypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import {
  buildGenesisRecord,
  buildLedgerExport,
  canonicalizeRecord,
  jwkToPublicKey,
  sha256Hex,
  toUtf8Bytes,
  verifyChain,
  type Envelope,
  type Es256Signature,
  type LedgerExport,
  type TestRecord,
} from '@fdtc/evidence-core';

import { audit, getDb } from '../adapters/db';
import { getDeviceIdentity, prepareSigner, signSync } from '../adapters/keystore';

/** Append-only device ledger (ARCHITECTURE §7.5, §7.6, §8).
 *
 * An append reads the head, sets seq and prev_hash, canonicalises, hashes,
 * signs, and inserts the ledger row, its projection and its outbox row — all
 * inside one synchronous SQLite transaction. Nothing awaits inside it, so two
 * appends can never claim the same seq. */

export const APP_VERSION = Constants.expoConfig?.version ?? '0.1.0';
export const PLATFORM = `${Platform.OS} ${Platform.Version}`;

interface LedgerRow {
  seq: number;
  record_id: string;
  record_type: string;
  payload: string;
  prev_hash: string | null;
  record_hash: string;
  signature: string;
  key_id: string;
  created_at: string;
}

function rowToEnvelope(row: LedgerRow): Envelope {
  return {
    fdtc_envelope: 1,
    record: JSON.parse(row.payload) as Record<string, unknown>,
    record_hash: row.record_hash,
    signature: JSON.parse(row.signature) as Es256Signature,
  };
}

function insertEnvelope(envelope: Envelope, payloadText: string): void {
  const r = envelope.record as { seq: number; record_id: string; record_type: string; prev_hash: string | null; created_at: string };
  const db = getDb();
  db.runSync(
    `INSERT INTO ledger (seq, record_id, record_type, payload, prev_hash, record_hash, signature, key_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.seq,
    r.record_id,
    r.record_type,
    payloadText,
    r.prev_hash,
    envelope.record_hash,
    JSON.stringify(envelope.signature),
    envelope.signature.key_id,
    r.created_at
  );
  db.runSync('INSERT INTO sync_outbox (record_id) VALUES (?)', r.record_id);
  projectTest(envelope);
}

/** test_index is a projection of TEST records; it can be rebuilt from ledger. */
function projectTest(envelope: Envelope): void {
  const r = envelope.record as Partial<TestRecord> & { schema?: string };
  if (r.schema !== 'fdtc.test/1' || !r.classification) return;
  getDb().runSync(
    `INSERT OR REPLACE INTO test_index
       (record_id, seq, created_at, operator_badge, kit_type, case_id, outcome, confidence, quality_score, evidence_sha256, retest_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.record_id!,
    r.seq!,
    r.created_at!,
    r.operator!.badge_id,
    r.kit!.kit_type,
    r.case?.case_id ?? null,
    r.classification.outcome,
    r.classification.confidence,
    r.quality?.score ?? null,
    r.evidence_image?.sha256 ?? null,
    r.retest_of?.record_id ?? null
  );
}

export function head(): { seq: number; record_hash: string } | null {
  return getDb().getFirstSync<{ seq: number; record_hash: string }>('SELECT seq, record_hash FROM ledger ORDER BY seq DESC LIMIT 1');
}

export function ledgerLength(): number {
  return getDb().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM ledger')?.n ?? 0;
}

/** Append a record. `build` receives the chain position and returns the full
 * record (including seq and prev_hash); `validate` may throw to abort. */
export async function append<T extends Record<string, unknown>>(
  build: (seq: number, prevHash: string | null) => T,
  validate?: (record: T) => void
): Promise<Envelope<T>> {
  const identity = await prepareSigner();
  const db = getDb();
  let sealed: Envelope<T> | null = null;

  db.withTransactionSync(() => {
    const h = head();
    const seq = h ? h.seq + 1 : 0;
    const record = build(seq, h ? h.record_hash : null);
    if ((record as { seq?: unknown }).seq !== seq) throw new Error('record seq does not match ledger head');
    validate?.(record);
    const payloadText = canonicalizeRecord(record);
    const payload = toUtf8Bytes(payloadText);
    const envelope: Envelope<T> = {
      fdtc_envelope: 1,
      record,
      record_hash: sha256Hex(payload),
      signature: signSync(payload, identity.keyId),
    };
    insertEnvelope(envelope as Envelope, payloadText);
    sealed = envelope;
  });

  if (!sealed) throw new Error('append did not complete');
  return sealed;
}

/** The Phase 0 spike kept its chain in a JSON file. Carry it over verbatim
 * (only if it verifies), so the device keeps a single chain from seq 0. */
function importLegacyChain(): number {
  const file = new File(new Directory(Paths.document, 'ledger'), 'records.json');
  if (!file.exists || ledgerLength() > 0) return 0;
  try {
    const parsed = JSON.parse(file.textSync()) as { records?: Envelope[] };
    const records = parsed.records ?? [];
    if (records.length === 0) return 0;
    const genesis = records[0].record as { public_key?: unknown };
    const publicKey = jwkToPublicKey(genesis.public_key as never);
    const check = verifyChain(
      records.map((e) => ({ seq: (e.record as { seq: number }).seq, prev_hash: (e.record as { prev_hash: string | null }).prev_hash, envelope: e, publicKey }))
    );
    if (!check.ok) {
      audit('LEGACY_CHAIN_REJECTED', JSON.stringify(check.failure));
      return 0;
    }
    getDb().withTransactionSync(() => {
      for (const e of records) insertEnvelope(e, canonicalizeRecord(e.record));
    });
    audit('LEGACY_CHAIN_IMPORTED', `${records.length} records`);
    return records.length;
  } catch (error) {
    audit('LEGACY_CHAIN_REJECTED', String(error));
    return 0;
  }
}

/** EVD-03: seq 0 of the device chain, created once on first launch. */
export async function ensureGenesis(): Promise<void> {
  importLegacyChain();
  if (ledgerLength() > 0) return;
  const identity = await getDeviceIdentity();
  await append(() =>
    buildGenesisRecord({
      publicKey: identity.publicKey,
      recordId: ExpoCrypto.randomUUID(),
      createdAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      platform: PLATFORM,
    }) as unknown as Record<string, unknown>
  );
}

export function allEnvelopes(): Envelope[] {
  return getDb().getAllSync<LedgerRow>('SELECT * FROM ledger ORDER BY seq').map(rowToEnvelope);
}

export function envelopeById(recordId: string): Envelope | null {
  const row = getDb().getFirstSync<LedgerRow>('SELECT * FROM ledger WHERE record_id = ?', recordId);
  return row ? rowToEnvelope(row) : null;
}

export async function exportLedger(): Promise<LedgerExport> {
  const identity = await getDeviceIdentity();
  return buildLedgerExport(allEnvelopes(), identity.deviceId);
}

/** EVD-09 (self-audit): re-verify the whole local chain. */
export async function auditChain(): Promise<ReturnType<typeof verifyChain>> {
  const identity = await getDeviceIdentity();
  return verifyChain(
    allEnvelopes().map((e) => ({
      seq: (e.record as { seq: number }).seq,
      prev_hash: (e.record as { prev_hash: string | null }).prev_hash,
      envelope: e,
      publicKey: identity.publicKey,
    }))
  );
}

export interface TestIndexRow {
  record_id: string;
  seq: number;
  created_at: string;
  operator_badge: string;
  kit_type: string;
  case_id: string | null;
  outcome: string;
  confidence: number | null;
  quality_score: number | null;
  evidence_sha256: string | null;
}

export function listTests(): TestIndexRow[] {
  return getDb().getAllSync<TestIndexRow>('SELECT * FROM test_index ORDER BY created_at DESC');
}

export function recordEvidenceFile(f: { sha256: string; recordId: string; kind: string; path: string; bytes: number; accepted: boolean }): void {
  getDb().runSync(
    'INSERT OR REPLACE INTO evidence_file (sha256, record_id, kind, path, bytes, accepted) VALUES (?, ?, ?, ?, ?, ?)',
    f.sha256,
    f.recordId,
    f.kind,
    f.path,
    f.bytes,
    f.accepted ? 1 : 0
  );
}

export function evidencePath(sha256: string): string | null {
  return getDb().getFirstSync<{ path: string }>('SELECT path FROM evidence_file WHERE sha256 = ?', sha256)?.path ?? null;
}
