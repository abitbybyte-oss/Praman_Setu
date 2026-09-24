import { canonicalizeRecord, toUtf8Bytes } from "./canonical";
import { sha256Hex } from "./hash";
import type { Envelope } from "./envelope";
import { jwkToPublicKey, type EcJwk } from "./keys";
import { verifyPayloadSignature } from "./sign";

/** The verification flow of ARCHITECTURE §11, as pure functions. verify.html is
 * only a UI over this; the app and the mock server use the same code, so there
 * is one implementation of the rules. */

export type Verdict = "VERIFIED" | "VERIFIED_WITH_WARNINGS" | "FAILED";
export type CheckStatus = "PASS" | "WARN" | "FAIL" | "SKIPPED";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface RegistryEntry {
  key_id: string;
  device_id?: string;
  jwk: EcJwk;
  status?: "ACTIVE" | "REVOKED" | string;
  registered_at?: string;
  registered_by?: string;
}

export interface KeyRegistry {
  generated_at?: string;
  keys: RegistryEntry[];
}

/** A multi-record export. A single envelope on its own is also accepted. */
export interface LedgerExport {
  fdtc_export: 1;
  kind: "LEDGER";
  device_id?: string;
  records: Envelope[];
}

/** What the app writes to the share sheet: the device's records in seq order.
 * Including GENESIS means the bundle carries the public key, so it can be
 * checked for internal consistency even with no registry to hand. */
export function buildLedgerExport(records: Envelope[], deviceId?: string): LedgerExport {
  return {
    fdtc_export: 1,
    kind: "LEDGER",
    device_id: deviceId,
    records: [...records].sort((a, b) => {
      const seqA = (a.record as Record<string, unknown>).seq;
      const seqB = (b.record as Record<string, unknown>).seq;
      return (typeof seqA === "number" ? seqA : 0) - (typeof seqB === "number" ? seqB : 0);
    }),
  };
}

export interface ImageInput {
  name: string;
  bytes: Uint8Array;
}

export interface VerifyInput {
  bundle: unknown;
  registry?: KeyRegistry | null;
  images?: ImageInput[];
}

export interface RecordSummary {
  seq: number | null;
  record_id: string | null;
  record_type: string | null;
  record_hash: string;
  created_at: string | null;
}

export interface VerifyReport {
  verdict: Verdict;
  checks: Check[];
  records: RecordSummary[];
}

type LooseRecord = Record<string, unknown>;

function isEnvelope(value: unknown): value is Envelope {
  const env = value as Envelope | null;
  return (
    !!env &&
    typeof env === "object" &&
    env.fdtc_envelope === 1 &&
    typeof env.record === "object" &&
    env.record !== null &&
    typeof env.record_hash === "string" &&
    !!env.signature &&
    typeof env.signature.value === "string"
  );
}

export function parseBundle(
  input: unknown
): { ok: true; records: Envelope[] } | { ok: false; detail: string } {
  if (isEnvelope(input)) return { ok: true, records: [input] };

  const exp = input as Partial<LedgerExport> | null;
  if (exp && typeof exp === "object" && Array.isArray(exp.records)) {
    if (exp.records.length === 0) return { ok: false, detail: "the export contains no records" };
    const bad = exp.records.findIndex((r) => !isEnvelope(r));
    if (bad !== -1) return { ok: false, detail: `record at position ${bad} is not a valid FDTC envelope` };
    return { ok: true, records: exp.records as Envelope[] };
  }

  return { ok: false, detail: "not an FDTC envelope or ledger export" };
}

function field(record: LooseRecord, name: string): string | null {
  const value = record[name];
  return typeof value === "string" ? value : null;
}

function summarise(envelope: Envelope): RecordSummary {
  const record = envelope.record as LooseRecord;
  return {
    seq: typeof record.seq === "number" ? record.seq : null,
    record_id: field(record, "record_id"),
    record_type: field(record, "record_type"),
    record_hash: envelope.record_hash,
    created_at: field(record, "created_at"),
  };
}

/** Public keys usable for verification, keyed by key_id. The registry is the
 * authority; a GENESIS record in the bundle is a fallback that only proves the
 * bundle is internally consistent, never that the signer is a real device. */
function collectPublicKeys(
  records: Envelope[],
  registry: KeyRegistry | null | undefined
): { fromRegistry: Map<string, RegistryEntry>; fromGenesis: Map<string, Uint8Array> } {
  const fromRegistry = new Map<string, RegistryEntry>();
  for (const entry of registry?.keys ?? []) {
    if (entry && typeof entry.key_id === "string") fromRegistry.set(entry.key_id, entry);
  }

  const fromGenesis = new Map<string, Uint8Array>();
  for (const envelope of records) {
    const record = envelope.record as LooseRecord;
    if (record.record_type !== "GENESIS") continue;
    const keyId = field(record, "key_id");
    const jwk = record.public_key as EcJwk | undefined;
    if (!keyId || !jwk) continue;
    try {
      fromGenesis.set(keyId, jwkToPublicKey(jwk));
    } catch {
      // A malformed GENESIS key is reported by the signature check below.
    }
  }

  return { fromRegistry, fromGenesis };
}

export function verifyBundle(input: VerifyInput): VerifyReport {
  const checks: Check[] = [];
  const parsed = parseBundle(input.bundle);

  if (!parsed.ok) {
    checks.push({
      id: "BUNDLE",
      label: "Record readable",
      status: "FAIL",
      detail: `Malformed record: ${parsed.detail}.`,
    });
    return { verdict: "FAILED", checks, records: [] };
  }

  const records = [...parsed.records].sort((a, b) => {
    const seqA = (a.record as LooseRecord).seq;
    const seqB = (b.record as LooseRecord).seq;
    return (typeof seqA === "number" ? seqA : 0) - (typeof seqB === "number" ? seqB : 0);
  });

  checks.push({
    id: "BUNDLE",
    label: "Record readable",
    status: "PASS",
    detail: `Loaded ${records.length} record${records.length === 1 ? "" : "s"}.`,
  });

  // 1. Content check — recompute SHA-256 over the canonical bytes.
  const payloads = new Map<Envelope, Uint8Array>();
  const altered: number[] = [];
  records.forEach((envelope, index) => {
    const payload = toUtf8Bytes(canonicalizeRecord(envelope.record));
    payloads.set(envelope, payload);
    if (sha256Hex(payload) !== envelope.record_hash) altered.push(index);
  });

  if (altered.length > 0) {
    checks.push({
      id: "RECORD_HASH",
      label: "Record content unchanged",
      status: "FAIL",
      detail: `The content of ${altered.length} record(s) does not match its recorded hash — the record was altered after signing.`,
    });
    return { verdict: "FAILED", checks, records: records.map(summarise) };
  }

  checks.push({
    id: "RECORD_HASH",
    label: "Record content unchanged",
    status: "PASS",
    detail: "Every record hashes to exactly the value stored with it.",
  });

  // 2. Signer check — is the key in the agency registry?
  const { fromRegistry, fromGenesis } = collectPublicKeys(records, input.registry);
  const keyIds = [...new Set(records.map((e) => e.signature.key_id))];
  const unregistered = keyIds.filter((id) => !fromRegistry.has(id));
  const revoked = keyIds.filter((id) => fromRegistry.get(id)?.status === "REVOKED");

  if (!input.registry) {
    checks.push({
      id: "SIGNER",
      label: "Signer registered with the agency",
      status: "WARN",
      detail: "No key registry was loaded, so the signing device could not be checked against the agency's list of issued keys.",
    });
  } else if (revoked.length > 0) {
    checks.push({
      id: "SIGNER",
      label: "Signer registered with the agency",
      status: "FAIL",
      detail: `Signing key ${revoked.join(", ")} has been revoked.`,
    });
  } else if (unregistered.length > 0) {
    checks.push({
      id: "SIGNER",
      label: "Signer registered with the agency",
      status: "FAIL",
      detail: `Signing key ${unregistered.join(", ")} is not in the agency registry — this record was not signed by a known device.`,
    });
  } else {
    const entry = fromRegistry.get(keyIds[0]);
    checks.push({
      id: "SIGNER",
      label: "Signer registered with the agency",
      status: "PASS",
      detail: entry?.registered_at
        ? `Key ${keyIds[0]} is registered${entry.device_id ? ` to ${entry.device_id}` : ""} since ${entry.registered_at}.`
        : `Key ${keyIds[0]} is in the agency registry.`,
    });
  }

  // 3. Signature check.
  const signatureFailures: string[] = [];
  let unverifiable = 0;
  for (const envelope of records) {
    const keyId = envelope.signature.key_id;
    const entry = fromRegistry.get(keyId);
    let publicKey: Uint8Array | undefined;
    if (entry) {
      try {
        publicKey = jwkToPublicKey(entry.jwk);
      } catch {
        publicKey = undefined;
      }
    }
    publicKey = publicKey ?? fromGenesis.get(keyId);

    if (!publicKey) {
      unverifiable += 1;
      continue;
    }

    const payload = payloads.get(envelope)!;
    let valid = false;
    try {
      valid = verifyPayloadSignature(payload, envelope.signature, publicKey);
    } catch {
      valid = false;
    }
    if (!valid) signatureFailures.push(summarise(envelope).record_id ?? envelope.record_hash.slice(0, 12));
  }

  if (signatureFailures.length > 0) {
    checks.push({
      id: "SIGNATURE",
      label: "Digital signature valid",
      status: "FAIL",
      detail: `The ES256 signature does not verify for ${signatureFailures.length} record(s).`,
    });
  } else if (unverifiable === records.length) {
    checks.push({
      id: "SIGNATURE",
      label: "Digital signature valid",
      status: "FAIL",
      detail: "No public key is available for the signing device, so the signature could not be checked. Load the agency key registry, or include the device's GENESIS record in the export.",
    });
  } else if (unverifiable > 0) {
    checks.push({
      id: "SIGNATURE",
      label: "Digital signature valid",
      status: "WARN",
      detail: `${records.length - unverifiable} of ${records.length} signatures verified; no public key was available for the rest.`,
    });
  } else {
    const source = fromRegistry.size > 0 ? "the agency registry" : "the device's own GENESIS record";
    checks.push({
      id: "SIGNATURE",
      label: "Digital signature valid",
      status: "PASS",
      detail: `Every record carries a valid ES256 signature, checked against the public key from ${source}.`,
    });
  }

  // 4. Image check — SHA-256 of the supplied file against the hashes in the record.
  const images = input.images ?? [];
  if (images.length === 0) {
    checks.push({
      id: "IMAGE",
      label: "Photograph matches the record",
      status: "SKIPPED",
      detail: "No image file was supplied, so the photograph could not be checked.",
    });
  } else {
    const knownHashes = new Map<string, string>();
    for (const envelope of records) {
      const record = envelope.record as LooseRecord;
      const evidence = record.evidence_image as LooseRecord | undefined;
      if (evidence && typeof evidence.sha256 === "string") {
        knownHashes.set(evidence.sha256, "the evidence photograph");
      }
      const captures = record.captures;
      if (Array.isArray(captures)) {
        for (const capture of captures as LooseRecord[]) {
          if (typeof capture?.sha256 === "string" && !knownHashes.has(capture.sha256)) {
            knownHashes.set(capture.sha256, `capture ${String(capture.n ?? "?")}`);
          }
        }
      }
    }

    const unmatched: string[] = [];
    const matched: string[] = [];
    for (const image of images) {
      const digest = sha256Hex(image.bytes);
      const role = knownHashes.get(digest);
      if (role) matched.push(`${image.name} is ${role}`);
      else unmatched.push(image.name);
    }

    if (unmatched.length > 0) {
      checks.push({
        id: "IMAGE",
        label: "Photograph matches the record",
        status: "FAIL",
        detail: `${unmatched.join(", ")} does not match any image hash in this record — the photograph was altered, or it belongs to a different test.`,
      });
    } else {
      checks.push({
        id: "IMAGE",
        label: "Photograph matches the record",
        status: "PASS",
        detail: `${matched.join("; ")}.`,
      });
    }
  }

  // 5. Chain checks, only meaningful for a multi-record export.
  if (records.length > 1) {
    let failure: string | null = null;
    for (let i = 0; i < records.length; i++) {
      const record = records[i].record as LooseRecord;
      if (record.seq !== i) {
        failure = `expected seq ${i} but found ${String(record.seq)} — a record is missing or out of order`;
        break;
      }
      const expectedPrev = i === 0 ? null : records[i - 1].record_hash;
      const actualPrev = record.prev_hash ?? null;
      if (actualPrev !== expectedPrev) {
        failure = `the link at seq ${i} does not point at the previous record`;
        break;
      }
    }
    checks.push({
      id: "CHAIN",
      label: "Record sequence unbroken",
      status: failure ? "FAIL" : "PASS",
      detail: failure
        ? `Chain broken: ${failure}.`
        : `All ${records.length} records form an unbroken chain from seq 0.`,
    });
  } else {
    checks.push({
      id: "CHAIN",
      label: "Record sequence unbroken",
      status: "SKIPPED",
      detail: "A single record was supplied, so its position in the device's chain could not be checked.",
    });
  }

  const hasFailure = checks.some((c) => c.status === "FAIL");
  const hasWarning = checks.some((c) => c.status === "WARN" || c.status === "SKIPPED");
  const verdict: Verdict = hasFailure ? "FAILED" : hasWarning ? "VERIFIED_WITH_WARNINGS" : "VERIFIED";

  return { verdict, checks, records: records.map(summarise) };
}
