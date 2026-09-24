import { roundTo } from '@fdtc/evidence-core';

/** EVD-06 clock-skew rule. Pure (no React Native) so it is tested in Node. */

/** EVD-06: device clock vs GNSS fix time beyond this is flagged. */
export const CLOCK_SKEW_LIMIT_S = 120;
/** A fix older than this (by the monotonic clock) is too stale to judge skew. */
export const FRESH_FIX_MS = 60_000;

/** Pure: derive the clock/integrity fields from a fix. Exported for tests. */
export function clockFromFix(
  now: number,
  mono: number,
  f: { fixTime: number; receivedAt: number; receivedMono: number } | null
): { gnss_time: string | null; skew_s: number | null; clock_skew: boolean | null } {
  if (!f || mono - f.receivedMono > FRESH_FIX_MS) return { gnss_time: null, skew_s: null, clock_skew: null };
  // Skew = how far the device clock was from the fix's own time when it arrived.
  const skew = (f.receivedAt - f.fixTime) / 1000;
  return {
    gnss_time: new Date(f.fixTime).toISOString(),
    skew_s: roundTo(skew, 1),
    clock_skew: Math.abs(skew) > CLOCK_SKEW_LIMIT_S,
  };
}
