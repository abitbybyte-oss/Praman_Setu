import * as Location from 'expo-location';
import { roundTo, type TestRecord } from '@fdtc/evidence-core';

import { clockFromFix } from './clock';

/** Where and when (ARCHITECTURE §7.3 location/clock/integrity, §13, §14).
 *
 * Location never blocks a test: if permission is denied or there is no fix in
 * time, the record says location_unavailable and the result screen shows it.
 * Integrity signals are flagged in the signed record; they never change the
 * result ("flag, don't hide"). */

interface Fix {
  fix: Location.LocationObject;
  /** Device wall clock and monotonic clock when the fix arrived. */
  receivedAt: number;
  receivedMono: number;
}

let pending: Promise<Fix | null> | null = null;

/** Start a fix early (when the capture screen opens) so it is ready at save. */
export function startLocationFix(): void {
  if (pending) return;
  pending = (async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return null;
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      return { fix, receivedAt: Date.now(), receivedMono: performance.now() };
    } catch {
      return null;
    }
  })();
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

function isRooted(): boolean | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const JailMonkey = require('jail-monkey').default as { isJailBroken(): boolean };
    return JailMonkey.isJailBroken();
  } catch {
    return null;
  }
}

export interface CaptureContext {
  location: TestRecord['location'];
  clock: TestRecord['clock'];
  integrity: TestRecord['integrity'];
}

export async function collectContext(): Promise<CaptureContext> {
  startLocationFix();
  const got = await withTimeout(pending!, 5000, null);
  pending = null;
  const now = Date.now();
  const mono = performance.now();
  const fix = got?.fix ?? null;

  const location: TestRecord['location'] = fix
    ? {
        lat: roundTo(fix.coords.latitude, 6),
        lon: roundTo(fix.coords.longitude, 6),
        accuracy_m: fix.coords.accuracy == null ? null : roundTo(fix.coords.accuracy, 1),
        fix_time: new Date(fix.timestamp).toISOString(),
        provider: 'fused',
        mocked: typeof fix.mocked === 'boolean' ? fix.mocked : null,
      }
    : null;

  const clock = clockFromFix(now, mono, got ? { fixTime: got.fix.timestamp, receivedAt: got.receivedAt, receivedMono: got.receivedMono } : null);

  return {
    location,
    clock: {
      device_time: new Date(now).toISOString(),
      gnss_time: clock.gnss_time,
      skew_s: clock.skew_s,
      monotonic_ms: Math.round(mono),
    },
    integrity: {
      rooted: isRooted(),
      mock_location: location?.mocked ?? null,
      clock_skew: clock.clock_skew,
      location_unavailable: location === null,
    },
  };
}

/** Plain list of raised integrity flags, for display. */
export function raisedFlags(i: TestRecord['integrity']): ('rooted' | 'mock_location' | 'clock_skew' | 'location_unavailable')[] {
  const out: ('rooted' | 'mock_location' | 'clock_skew' | 'location_unavailable')[] = [];
  if (i.rooted) out.push('rooted');
  if (i.mock_location) out.push('mock_location');
  if (i.clock_skew) out.push('clock_skew');
  if (i.location_unavailable) out.push('location_unavailable');
  return out;
}
