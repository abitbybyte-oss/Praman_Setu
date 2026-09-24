/** Reaction timer (TMR-01..07). Pure: no React Native.
 *
 * The timer is stored as its start time, never as a running counter, so it
 * survives the app being backgrounded or killed: elapsed time is always
 * recomputed from the stored timestamp (TMR-06). The interval comes from the
 * kit protocol in the signed Reference DB and cannot be edited (TMR-02). */

export type TimerMode = 'KIT_PROTOCOL' | 'DEMO_PROTOCOL';

export interface ReactionTimer {
  mode: TimerMode;
  /** ISO time START TIMER was pressed. */
  start: string;
  required_s: number;
  max_s: number;
}

export type WindowState = 'WAITING' | 'OPEN' | 'LATE';

export function startTimer(protocol: { required_s: number; max_s: number; demo_required_s: number }, demo: boolean, now: Date = new Date()): ReactionTimer {
  return {
    mode: demo ? 'DEMO_PROTOCOL' : 'KIT_PROTOCOL',
    start: now.toISOString(),
    required_s: demo ? protocol.demo_required_s : protocol.required_s,
    max_s: protocol.max_s,
  };
}

export function elapsedSeconds(t: ReactionTimer, nowMs: number = Date.now()): number {
  return Math.max(0, (nowMs - Date.parse(t.start)) / 1000);
}

export function windowState(t: ReactionTimer, nowMs: number = Date.now()): { state: WindowState; elapsed_s: number; remaining_s: number } {
  const elapsed_s = elapsedSeconds(t, nowMs);
  const state: WindowState = elapsed_s < t.required_s ? 'WAITING' : elapsed_s <= t.max_s ? 'OPEN' : 'LATE';
  return { state, elapsed_s, remaining_s: Math.max(0, t.required_s - elapsed_s) };
}

/** TMR-05: a capture outside [required_s, max_s] forces Inconclusive. */
export function inWindow(t: ReactionTimer, elapsed_s: number): boolean {
  return elapsed_s >= t.required_s && elapsed_s <= t.max_s;
}

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
