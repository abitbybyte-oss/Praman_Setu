import { parseTestRecord, type Envelope, type TestRecord } from '@fdtc/evidence-core';

import { getDeviceIdentity } from '../adapters/keystore';
import type { CaptureContext } from './context';
import { workingCopy } from './image';
import { append, APP_VERSION, PLATFORM, recordEvidenceFile } from './ledger';
import { buildTestRecord, finalClassification } from './recordBuilder';
import { DEFAULT_CARD, kit, loadRefdb } from './refdb';
import { currentCapture, type Draft } from '../workflow/draft';

/** Save transaction (ARCHITECTURE §7.6): gather context, build the record,
 * schema-check it inside the ledger append, sign and chain it. */

export function preview(d: Draft) {
  return finalClassification(d);
}

/** `ctx` is the time/location shown on the result screen: the officer saw
 * exactly what gets signed. */
export async function saveTest(d: Draft, ctx: CaptureContext): Promise<Envelope<TestRecord>> {
  const identity = await getDeviceIdentity();
  const refdb = loadRefdb();
  const cap = currentCapture(d);
  const w = cap ? await workingCopy(cap.uri) : null;
  const createdAt = new Date().toISOString();

  const envelope = await append(
    (seq, prevHash) =>
      buildTestRecord(
        {
          draft: d,
          operator: d.operator,
          ctx,
          identity,
          refdb: { version: refdb.version, sha256: refdb.sha256 },
          profile: kit(d.kitType),
          cardVersion: DEFAULT_CARD,
          wc: w ? { width: w.img.width, height: w.img.height, scale: w.scale, origWidth: w.origWidth, origHeight: w.origHeight } : null,
          app: { version: APP_VERSION, platform: PLATFORM },
          createdAt,
        },
        seq,
        prevHash
      ),
    (rec) => {
      parseTestRecord(rec);
    }
  );

  for (const c of d.captures) {
    recordEvidenceFile({ sha256: c.sha256, recordId: d.recordId, kind: 'capture', path: c.uri, bytes: c.bytes, accepted: c.accepted });
  }
  return envelope;
}
