import { getDeviceIdentity } from '../adapters/keystore';
import { append, APP_VERSION, ensureGenesis as ensureLedgerGenesis, exportLedger, ledgerLength, PLATFORM } from './ledger';
import type { StoredCapture } from './evidence';
import type { Envelope, LedgerExport } from '@fdtc/evidence-core';

/** Phase 0 spike, now backed by the SQLite ledger. Its fdtc.spike/1 records
 * share the device chain with real TEST records; they are not indexed as tests. */

export async function ensureGenesis(): Promise<Envelope> {
  await ensureLedgerGenesis();
  const { allEnvelopes } = await import('./ledger');
  return allEnvelopes()[0];
}

export interface SpikeRecordInput {
  capture: StoredCapture;
  recordId: string;
  width: number;
  height: number;
}

export async function appendSpikeRecord(input: SpikeRecordInput): Promise<Envelope> {
  await ensureLedgerGenesis();
  const identity = await getDeviceIdentity();
  const now = new Date().toISOString();
  return append((seq, prevHash) => ({
    schema: 'fdtc.spike/1',
    record_type: 'TEST',
    record_id: input.recordId,
    device_id: identity.deviceId,
    key_id: identity.keyId,
    seq,
    prev_hash: prevHash,
    created_at: now,
    simulated: true,
    source: 'CAMERA',
    captures: [{ n: 1, sha256: input.capture.sha256, bytes: input.capture.bytes, taken_at: now, accepted: true }],
    evidence_image: { n: 1, sha256: input.capture.sha256, mime: 'image/jpeg', bytes: input.capture.bytes, width: input.width, height: input.height },
    app: { version: APP_VERSION, platform: PLATFORM },
  }));
}

export function currentExport(): Promise<LedgerExport> {
  return exportLedger();
}

export function chainLength(): number {
  return ledgerLength();
}
