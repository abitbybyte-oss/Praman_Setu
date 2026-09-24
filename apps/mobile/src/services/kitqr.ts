import { sha256Hex, toUtf8Bytes } from '@fdtc/evidence-core';

/** Kit QR (KIT-03/04/05, PRD §8.3). Pure: no React Native.
 *
 * Payload (simulated demo kits, one line, '|'-separated):
 *   FDTC-KIT|1|<kit_id>|<kit_type>|<manufacturer>|<batch>|<mfg YYYY-MM-DD>|<expiry YYYY-MM-DD>|SIMULATED
 *
 * The SHA-256 of the exact raw payload goes into the record, so the scanned
 * label can be matched to the record later. */

export const KIT_QR_PREFIX = 'FDTC-KIT';
export const KIT_QR_VERSION = '1';

export type KitStatus = 'VALID' | 'EXPIRED' | 'NOT_YET_VALID' | 'UNRECOGNISED';
export type KitProblem = 'NOT_A_KIT_QR' | 'MALFORMED' | 'BAD_DATE' | 'UNKNOWN_KIT_TYPE' | 'UNKNOWN_MANUFACTURER' | 'NOT_SIMULATED';

export interface KitQr {
  kit_id: string;
  kit_type: string;
  manufacturer: string;
  batch: string;
  mfg_date: string;
  expiry_date: string;
}

export interface KitScan {
  status: KitStatus;
  /** Why the kit is not VALID (UNRECOGNISED has one; EXPIRED/NOT_YET_VALID do not). */
  problem: KitProblem | null;
  kit: KitQr | null;
  qr_sha256: string;
  /** The device date the rule was applied on (clock-skew caveat, ARCHITECTURE §13). */
  checked_on: string;
}

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function formatKitQr(k: KitQr): string {
  return [KIT_QR_PREFIX, KIT_QR_VERSION, k.kit_id, k.kit_type, k.manufacturer, k.batch, k.mfg_date, k.expiry_date, 'SIMULATED'].join('|');
}

/** Local calendar date (the officer's "today"), YYYY-MM-DD. */
export function localDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Apply PRD §8.3. Only VALID may continue. */
export function checkKitQr(
  raw: string,
  refdb: { kits: Record<string, unknown>; manufacturers?: string[] },
  today: string = localDate()
): KitScan {
  const qr_sha256 = sha256Hex(toUtf8Bytes(raw));
  const bad = (problem: KitProblem, kit: KitQr | null = null): KitScan => ({ status: 'UNRECOGNISED', problem, kit, qr_sha256, checked_on: today });

  const parts = raw.trim().split('|');
  if (parts[0] !== KIT_QR_PREFIX) return bad('NOT_A_KIT_QR');
  if (parts.length !== 9 || parts[1] !== KIT_QR_VERSION || parts.slice(2, 8).some((p) => p.trim() === '')) return bad('MALFORMED');
  const [, , kit_id, kit_type, manufacturer, batch, mfg_date, expiry_date, marker] = parts.map((p) => p.trim());
  const kit: KitQr = { kit_id, kit_type, manufacturer, batch, mfg_date, expiry_date };
  if (marker !== 'SIMULATED') return bad('NOT_SIMULATED', kit);
  if (!isRealDate(mfg_date) || !isRealDate(expiry_date) || mfg_date > expiry_date) return bad('BAD_DATE', kit);
  if (!(kit_type in refdb.kits)) return bad('UNKNOWN_KIT_TYPE', kit);
  if (refdb.manufacturers && !refdb.manufacturers.includes(manufacturer)) return bad('UNKNOWN_MANUFACTURER', kit);

  const status: KitStatus = today > expiry_date ? 'EXPIRED' : mfg_date > today ? 'NOT_YET_VALID' : 'VALID';
  return { status, problem: null, kit, qr_sha256, checked_on: today };
}
