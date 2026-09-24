import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import { MIGRATION_1, SCHEMA_VERSION } from './schema';

/** Local storage (ARCHITECTURE §8.1).
 *
 * `ledger` is the evidence: append-only, enforced by triggers. Everything else
 * is a projection or working state and can be rebuilt from the ledger. The
 * triggers guard against app bugs; the chain and signatures are what make
 * tampering detectable. */

let db: SQLiteDatabase | null = null;

export function getDb(): SQLiteDatabase {
  if (db) return db;
  const opened = openDatabaseSync('fdtc.db');
  opened.execSync('PRAGMA journal_mode = WAL;');
  const row = opened.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  if ((row?.user_version ?? 0) < 1) {
    opened.withTransactionSync(() => {
      opened.execSync(MIGRATION_1);
      opened.execSync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  }
  db = opened;
  return db;
}

export function audit(event: string, detail?: string): void {
  getDb().runSync('INSERT INTO audit_log (at, event, detail) VALUES (?, ?, ?)', new Date().toISOString(), event, detail ?? null);
}
