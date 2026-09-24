import * as ExpoCrypto from 'expo-crypto';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesToBase64Url, base64UrlToBytes } from '@fdtc/evidence-core';

import { audit, getDb } from '../adapters/db';

/** AUTH-01: badge + PIN against a local mock operator directory. PINs are
 * stored as salted scrypt hashes. The badge is written into every record; the
 * signature attests the device, not the person (ARCHITECTURE §9). */

export type Role = 'OFFICER' | 'SUPERVISOR';

export interface Operator {
  badge_id: string;
  name: string;
  role: Role;
}

// Prototype-scale cost: ~0.3 s on a mid-range phone in Hermes.
const SCRYPT = { N: 2 ** 12, r: 8, p: 1, dkLen: 32 };

/** Demo directory. Printed on the login screen; not secrets. */
export const DEMO_OPERATORS: (Operator & { pin: string })[] = [
  { badge_id: '1001', name: 'Demo Officer', role: 'OFFICER', pin: '1234' },
  { badge_id: '1002', name: 'Demo Officer 2', role: 'OFFICER', pin: '1234' },
  { badge_id: '2001', name: 'Demo Supervisor', role: 'SUPERVISOR', pin: '2468' },
];

async function hashPin(pin: string, salt: Uint8Array): Promise<string> {
  const key = await scryptAsync(new TextEncoder().encode(pin), salt, SCRYPT);
  return bytesToBase64Url(key);
}

export async function seedOperators(): Promise<void> {
  const db = getDb();
  const have = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM operator')?.n ?? 0;
  if (have > 0) return;
  for (const op of DEMO_OPERATORS) {
    const salt = ExpoCrypto.getRandomBytes(16);
    db.runSync(
      'INSERT INTO operator (badge_id, name, role, pin_hash, pin_salt) VALUES (?, ?, ?, ?, ?)',
      op.badge_id,
      op.name,
      op.role,
      await hashPin(op.pin, salt),
      bytesToBase64Url(salt)
    );
  }
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function login(badgeId: string, pin: string): Promise<Operator> {
  const row = getDb().getFirstSync<Operator & { pin_hash: string; pin_salt: string }>(
    'SELECT * FROM operator WHERE badge_id = ?',
    badgeId.trim()
  );
  // Hash even for an unknown badge, so timing does not reveal which badges exist.
  const salt = row ? base64UrlToBytes(row.pin_salt) : new Uint8Array(16);
  const hash = await hashPin(pin, salt);
  if (!row || !equal(hash, row.pin_hash)) {
    audit('LOGIN_FAILED', badgeId.trim());
    throw new Error('Badge ID or PIN is incorrect.');
  }
  audit('LOGIN', row.badge_id);
  return { badge_id: row.badge_id, name: row.name, role: row.role };
}
