import type { Circle, CornerId, InconclusiveReason, Point } from '@fdtc/color-core';

import type { CardResult, SampleResult } from '../services/measure';

/** Test draft types and guards (ARCHITECTURE §5.3). Pure: no React Native. */

export interface CaptureEntry {
  n: number;
  uri: string;
  sha256: string;
  bytes: number;
  taken_at: string;
  accepted: boolean;
  reject_reasons: string[];
  laplacian_variance: number | null;
}

export type EndedEarly = { kind: 'CARD_INVALID' | 'HARD_GATE' | 'ABANDONED'; reasons: InconclusiveReason[] };

export interface Draft {
  recordId: string;
  startedAt: string;
  kitType: string;
  caseId: string | null;
  witness: string | null;
  captures: CaptureEntry[];
  corners: Record<CornerId, Point> | null;
  cornersSnapped: boolean[];
  card: CardResult | null;
  roi: Circle | null;
  sample: SampleResult | null;
  endedEarly: EndedEarly | null;
}

/** The latest accepted capture: the one being calibrated and measured. */
export function currentCapture(d: Draft | null): CaptureEntry | null {
  if (!d) return null;
  for (let i = d.captures.length - 1; i >= 0; i--) if (d.captures[i].accepted) return d.captures[i];
  return null;
}

/** Guards from ARCHITECTURE §5.3. */
export const guards = {
  hasCapture: (d: Draft | null) => !!currentCapture(d),
  cardValid: (d: Draft | null) => !!d?.card && d.card.calibration.card_status === 'VALID',
  measured: (d: Draft | null) => !!d?.sample,
  canSave: (d: Draft | null) => !!d && (!!d.sample || !!d.endedEarly),
};
