import type { Envelope } from "./envelope";
import { checkEnvelope } from "./envelope";

export interface ChainLedgerRow {
  seq: number;
  prev_hash: string | null;
  envelope: Envelope;
  publicKey: Uint8Array;
}

export type ChainCheckFailure =
  | { seq: number; reason: "SEQ_GAP"; expectedSeq: number }
  | { seq: number; reason: "BROKEN_LINK" }
  | { seq: number; reason: "RECORD_ALTERED" }
  | { seq: number; reason: "SIGNATURE_INVALID" }
  | { seq: number; reason: "MALFORMED_ENVELOPE" };

/** Chain check for a ledger export (ARCHITECTURE §11): seq contiguous from 0,
 * every prev_hash link holds, every signature is valid. Stops at (and reports)
 * the first failing seq rather than failing the whole export silently. */
export function verifyChain(rows: ChainLedgerRow[]): { ok: true } | { ok: false; failure: ChainCheckFailure } {
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];

    if (row.seq !== i) {
      return { ok: false, failure: { seq: row.seq, reason: "SEQ_GAP", expectedSeq: i } };
    }

    const envelopeResult = checkEnvelope(row.envelope, row.publicKey);
    if (!envelopeResult.ok) {
      const reason =
        envelopeResult.reason === "RECORD_ALTERED"
          ? "RECORD_ALTERED"
          : envelopeResult.reason === "SIGNATURE_INVALID"
            ? "SIGNATURE_INVALID"
            : "MALFORMED_ENVELOPE";
      return { ok: false, failure: { seq: row.seq, reason } };
    }

    if (i > 0 && row.prev_hash !== sorted[i - 1].envelope.record_hash) {
      return { ok: false, failure: { seq: row.seq, reason: "BROKEN_LINK" } };
    }
  }

  return { ok: true };
}
