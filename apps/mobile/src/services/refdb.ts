import { verifyReferenceDb, type KitProfile, type SignedReferenceDb } from '@fdtc/refdb';
import type { CardReference } from '@fdtc/color-core';

import agencyKey from '../refdb/agency-refdb.pub.json';
import signed from '../refdb/refdb.signed.json';

/** EVD-07: the Reference DB ships signed and is verified at start-up against
 * the agency key baked into the app. If it fails, tests are blocked. Its
 * version and SHA-256 go into every TEST record. */

export interface LoadedRefdb {
  db: SignedReferenceDb;
  version: string;
  sha256: string;
}

let loaded: LoadedRefdb | null = null;
let failure: string | null = null;

export function loadRefdb(): LoadedRefdb {
  if (loaded) return loaded;
  const db = signed as unknown as SignedReferenceDb;
  const check = verifyReferenceDb(db, agencyKey.jwk as never, agencyKey.key_id);
  if (!check.ok) {
    failure = check.reason;
    throw new Error(`REFDB_${check.reason}`);
  }
  loaded = { db, version: check.version, sha256: check.sha256 };
  return loaded;
}

export function refdbFailure(): string | null {
  return failure;
}

export const DEFAULT_CARD = 'FDTC-CARD-1';

export function cardReference(version = DEFAULT_CARD): CardReference | undefined {
  const card = loadRefdb().db.cards[version];
  return card as unknown as CardReference | undefined;
}

export function kits(): [string, KitProfile][] {
  return Object.entries(loadRefdb().db.kits);
}

export function kit(type: string): KitProfile {
  const k = loadRefdb().db.kits[type];
  if (!k) throw new Error(`unknown kit type ${type}`);
  return k;
}

export function thresholds(): Record<string, number> {
  return loadRefdb().db.thresholds;
}

export function qualityWeights(): Record<string, number> {
  return loadRefdb().db.quality_weights;
}
