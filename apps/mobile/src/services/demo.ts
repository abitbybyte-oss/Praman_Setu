import { getSetting, setSetting } from '../adapters/db';

/** Demo timing: use the kit profile's demo_required_s (e.g. 20 s) instead of
 * the full reaction time, so the timer fits a pitch. The record says which
 * protocol value was used (timing.timer = DEMO_PROTOCOL). On by default. */
export function demoTiming(): boolean {
  return getSetting('demo_timing') !== 'off';
}

export function setDemoTiming(on: boolean): void {
  setSetting('demo_timing', on ? 'on' : 'off');
}
