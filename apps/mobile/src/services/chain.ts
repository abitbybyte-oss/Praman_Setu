import Constants from 'expo-constants';
import * as ExpoCrypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import {
  buildGenesisRecord,
  buildLedgerExport,
  type Envelope,
  type LedgerExport,
} from '@fdtc/evidence-core';

import { getDeviceIdentity } from '../adapters/keystore';
import { sealRecordWithDeviceKey, type StoredCapture } from './evidence';

/** Phase 0 device chain, held in a JSON file.
 *
 * Phase 1 replaces this with the SQLite ledger of ARCHITECTURE §8, where an
 * append-only table and BEGIN IMMEDIATE give the seq/prev_hash guarantees. The
 * record format and the chain rule are already the real ones, so only the
 * storage changes. */

const APP_VERSION = Constants.expoConfig?.version ?? '0.1.0';
const PLATFORM = `${Platform.OS} ${Platform.Version}`;

function ledgerFile(): File {
  const directory = new Directory(Paths.document, 'ledger');
  if (!directory.exists) directory.create({ intermediates: true });
  return new File(directory, 'records.json');
}

function readChain(): Envelope[] {
  const file = ledgerFile();
  if (!file.exists) return [];
  try {
    const parsed = JSON.parse(file.textSync()) as { records?: Envelope[] };
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

function writeChain(records: Envelope[]): void {
  const file = ledgerFile();
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify({ records }, null, 2));
}

/** EVD-03: the device's seq 0 record, created once on first launch. */
export async function ensureGenesis(): Promise<Envelope> {
  const existing = readChain();
  if (existing.length > 0) return existing[0];

  const identity = await getDeviceIdentity();
  const record = buildGenesisRecord({
    publicKey: identity.publicKey,
    recordId: ExpoCrypto.randomUUID(),
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    platform: PLATFORM,
  });

  const envelope = await sealRecordWithDeviceKey(record as unknown as Record<string, unknown>, identity.keyId);
  writeChain([envelope]);
  return envelope;
}

export interface SpikeRecordInput {
  capture: StoredCapture;
  recordId: string;
  width: number;
  height: number;
}

/** The Phase 0 spike record. Deliberately NOT schema fdtc.test/1 — that record
 * carries calibration, measurement and classification, which Phase 1 adds. */
export async function appendSpikeRecord(input: SpikeRecordInput): Promise<Envelope> {
  const chain = readChain();
  if (chain.length === 0) throw new Error('GENESIS must exist before any other record');

  const identity = await getDeviceIdentity();
  const head = chain[chain.length - 1];

  const record = {
    schema: 'fdtc.spike/1',
    record_type: 'TEST',
    record_id: input.recordId,
    device_id: identity.deviceId,
    key_id: identity.keyId,
    seq: chain.length,
    prev_hash: head.record_hash,
    created_at: new Date().toISOString(),
    simulated: true,
    source: 'CAMERA',
    captures: [
      {
        n: 1,
        sha256: input.capture.sha256,
        bytes: input.capture.bytes,
        taken_at: new Date().toISOString(),
        accepted: true,
      },
    ],
    evidence_image: {
      n: 1,
      sha256: input.capture.sha256,
      mime: 'image/jpeg',
      bytes: input.capture.bytes,
      width: input.width,
      height: input.height,
    },
    app: { version: APP_VERSION, platform: PLATFORM },
  };

  const envelope = await sealRecordWithDeviceKey(record, identity.keyId);
  writeChain([...chain, envelope]);
  return envelope;
}

export async function currentExport(): Promise<LedgerExport> {
  const identity = await getDeviceIdentity();
  return buildLedgerExport(readChain(), identity.deviceId);
}

export function chainLength(): number {
  return readChain().length;
}

/** Demo convenience: start a fresh chain without reinstalling. The device key
 * is kept, so the same device identity signs the new chain. */
export function resetChain(): void {
  const file = ledgerFile();
  if (file.exists) file.delete();
}
