import * as ExpoCrypto from 'expo-crypto';
import { parseVoidRecord, type Envelope, type VoidRecord } from '@fdtc/evidence-core';

import { getDeviceIdentity } from '../adapters/keystore';
import type { Operator } from './auth';
import { append, APP_VERSION, envelopeById, PLATFORM, voidFor } from './ledger';

/** HIS-04: void a TEST record. Nothing is deleted — a signed VOID record is
 * appended that names the target by record_id and record_hash. */
export async function voidTest(targetId: string, reason: string, operator: Operator): Promise<Envelope<VoidRecord>> {
  const target = envelopeById(targetId);
  const t = target?.record as { schema?: string } | undefined;
  if (!target || t?.schema !== 'fdtc.test/1') throw new Error('Only a saved test record can be voided.');
  if (voidFor(targetId)) throw new Error('This record is already voided.');

  const identity = await getDeviceIdentity();
  const createdAt = new Date().toISOString();
  return append(
    (seq, prevHash): VoidRecord => ({
      schema: 'fdtc.void/1',
      record_type: 'VOID',
      record_id: ExpoCrypto.randomUUID(),
      device_id: identity.deviceId,
      key_id: identity.keyId,
      seq,
      prev_hash: prevHash!,
      created_at: createdAt,
      simulated: true,
      operator: { badge_id: operator.badge_id, role: operator.role, auth_method: 'PIN' },
      target: { record_id: targetId, record_hash: target.record_hash },
      reason: reason.trim(),
      app: { version: APP_VERSION, platform: PLATFORM },
    }),
    (rec) => {
      parseVoidRecord(rec);
    }
  );
}
