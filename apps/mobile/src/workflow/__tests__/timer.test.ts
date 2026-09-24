import { describe, expect, it } from 'vitest';

import { elapsedSeconds, inWindow, mmss, startTimer, windowState } from '../timer';

const protocol = { required_s: 120, max_s: 300, demo_required_s: 20 };
const t0 = new Date('2026-09-24T10:00:00.000Z');
const at = (s: number) => t0.getTime() + s * 1000;

describe('reaction timer (TMR-01..07)', () => {
  it('uses the kit protocol, or the demo interval when demo mode is on', () => {
    expect(startTimer(protocol, false, t0)).toEqual({ mode: 'KIT_PROTOCOL', start: t0.toISOString(), required_s: 120, max_s: 300 });
    expect(startTimer(protocol, true, t0).required_s).toBe(20);
    expect(startTimer(protocol, true, t0).mode).toBe('DEMO_PROTOCOL');
  });

  it('TMR-03/04: waiting until required_s, then open, then late after max_s', () => {
    const t = startTimer(protocol, false, t0);
    expect(windowState(t, at(119.9)).state).toBe('WAITING');
    expect(windowState(t, at(119.9)).remaining_s).toBeCloseTo(0.1, 5);
    expect(windowState(t, at(120)).state).toBe('OPEN');
    expect(windowState(t, at(300)).state).toBe('OPEN');
    expect(windowState(t, at(300.1)).state).toBe('LATE');
  });

  it('TMR-05: in-window is inclusive of both ends', () => {
    const t = startTimer(protocol, false, t0);
    expect(inWindow(t, 120)).toBe(true);
    expect(inWindow(t, 300)).toBe(true);
    expect(inWindow(t, 300.5)).toBe(false);
    expect(inWindow(t, 60)).toBe(false);
  });

  it('TMR-06: elapsed is recomputed from the stored start (survives backgrounding)', () => {
    const t = JSON.parse(JSON.stringify(startTimer(protocol, false, t0)));
    expect(elapsedSeconds(t, at(3600))).toBe(3600);
    expect(elapsedSeconds(t, at(-5))).toBe(0); // clock moved back: never negative
  });

  it('formats a countdown', () => {
    expect(mmss(119.2)).toBe('2:00');
    expect(mmss(5)).toBe('0:05');
    expect(mmss(-3)).toBe('0:00');
  });
});
