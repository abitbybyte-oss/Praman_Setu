import type { Circle, CornerId, InconclusiveReason, Point } from '@fdtc/color-core';

import type { Operator } from '../services/auth';
import type { KitScan } from '../services/kitqr';
import type { ReactionTimer } from './timer';
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
  /** Seconds since START TIMER when this photo was taken (TMR-07). */
  elapsed_s: number | null;
}

export type EndedEarly = { kind: 'CARD_INVALID' | 'HARD_GATE' | 'ABANDONED'; reasons: InconclusiveReason[] };

export interface Draft {
  recordId: string;
  startedAt: string;
  /** Who started the test; the record is attributed to them even if someone else ends it. */
  operator: Operator;
  kitType: string;
  /** KIT-03: the scanned kit, or null for a manual selection. */
  kitScan: KitScan | null;
  /** Validation-study capture (dev): the true swatch and lighting. Not evidence. */
  study?: { truthClass: string; lighting: string } | null;
  /** TMR-02: set by START TIMER. */
  timer: ReactionTimer | null;
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

/** EVD-08: where to resume an interrupted test. */
export function resumeRoute(d: Draft): '/test/timer' | '/test/capture' | '/test/card' | '/test/roi' | '/test/result' {
  if (d.endedEarly || d.sample) return '/test/result';
  if (!d.timer && !d.study) return '/test/timer';
  if (d.card && d.card.calibration.card_status === 'VALID') return '/test/roi';
  if (currentCapture(d)) return '/test/card';
  return '/test/capture';
}

/** Guards from ARCHITECTURE §5.3. */
export const guards = {
  hasCapture: (d: Draft | null) => !!currentCapture(d),
  cardValid: (d: Draft | null) => !!d?.card && d.card.calibration.card_status === 'VALID',
  measured: (d: Draft | null) => !!d?.sample,
  canSave: (d: Draft | null) => !!d && (!!d.sample || !!d.endedEarly),
};
