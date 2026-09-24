import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { KeyRegistry, RegistryEntry } from "@fdtc/evidence-core";

/** Flat-file store for the device key registry.
 *
 * ARCHITECTURE §4 calls for SQLite here. A JSON file is enough while the
 * registry is the only thing persisted; the ledger ingest in Phase 2 (SYN-01)
 * is what makes SQLite worth the native dependency. */

const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../data");
const registryPath = resolve(dataDir, "registry.json");

export interface StoredEntry extends RegistryEntry {
  device_token: string;
}

function read(): StoredEntry[] {
  if (!existsSync(registryPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as { keys?: StoredEntry[] };
    return Array.isArray(parsed.keys) ? parsed.keys : [];
  } catch {
    return [];
  }
}

function write(keys: StoredEntry[]): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(registryPath, JSON.stringify({ keys }, null, 2) + "\n");
}

export function findByKeyId(keyId: string): StoredEntry | undefined {
  return read().find((entry) => entry.key_id === keyId);
}

/** Registration is idempotent: re-registering a key returns the original entry
 * rather than issuing a second one, so a retried sync is harmless. */
export function upsert(entry: StoredEntry): { entry: StoredEntry; created: boolean } {
  const keys = read();
  const existing = keys.find((candidate) => candidate.key_id === entry.key_id);
  if (existing) return { entry: existing, created: false };
  keys.push(entry);
  write(keys);
  return { entry, created: true };
}

/** The public view served to verifiers — device tokens never leave the server. */
export function publicRegistry(): KeyRegistry {
  return {
    generated_at: new Date().toISOString(),
    keys: read().map(({ device_token: _token, ...entry }) => entry),
  };
}
