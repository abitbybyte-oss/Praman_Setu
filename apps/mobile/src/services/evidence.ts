import { Directory, File, Paths } from 'expo-file-system';
import {
  canonicalizeRecord,
  sha256Hex,
  toUtf8Bytes,
  type Envelope,
} from '@fdtc/evidence-core';

import { sign } from '../adapters/keystore';

/** Capture storage and record sealing (ARCHITECTURE §7.5, §8.2).
 *
 * The original JPEG is written once, hashed over its exact bytes, and never
 * re-encoded. Everything downstream works from the hash, so any later edit to
 * the file is detectable. */

export interface StoredCapture {
  uri: string;
  sha256: string;
  bytes: number;
}

function evidenceDirectory(recordId: string): Directory {
  const directory = new Directory(Paths.document, 'evidence', recordId);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

/** CAP-02: move the camera's output into the evidence directory under a
 * hash-stamped name, hashing the bytes as written. */
export async function storeCapture(sourcePath: string, recordId: string, n: number): Promise<StoredCapture> {
  const source = new File(sourcePath.startsWith('file://') ? sourcePath : `file://${sourcePath}`);
  const bytes = await source.bytes();
  const digest = sha256Hex(bytes);

  const name = `capture-${String(n).padStart(2, '0')}-${digest.slice(0, 8)}.jpg`;
  const target = new File(evidenceDirectory(recordId), name);
  if (target.exists) target.delete();
  source.move(target);

  return { uri: target.uri, sha256: digest, bytes: bytes.length };
}

/** The app-side half of the save transaction: canonicalise, hash, then sign.
 * The private key never leaves the keystore adapter. */
export async function sealRecordWithDeviceKey<TRecord extends Record<string, unknown>>(
  record: TRecord,
  keyId: string
): Promise<Envelope<TRecord>> {
  const payload = toUtf8Bytes(canonicalizeRecord(record));
  const record_hash = sha256Hex(payload);
  const signature = await sign(payload, keyId);
  return { fdtc_envelope: 1, record, record_hash, signature };
}

export function writeJsonFile(name: string, value: unknown): File {
  const directory = new Directory(Paths.document, 'exports');
  if (!directory.exists) directory.create({ intermediates: true });
  const file = new File(directory, name);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(value, null, 2));
  return file;
}
