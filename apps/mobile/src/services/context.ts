import * as Location from 'expo-location';
import { roundTo, type TestRecord } from '@fdtc/evidence-core';

/** Where and when (ARCHITECTURE §7.3 location/clock/integrity, §14).
 *
 * Location never blocks a test: if permission is denied or there is no fix in
 * time, the record says location_unavailable and the result screen shows it. */

let pending: Promise<Location.LocationObject | null> | null = null;

/** Start a fix early (when the capture screen opens) so it is ready at save. */
export function startLocationFix(): void {
  if (pending) return;
  pending = (async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return null;
      return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
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
    // Optional native module; absent in some builds.
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
  const fix = await withTimeout(pending!, 5000, null);
  pending = null;
  const now = new Date();

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

  return {
    location,
    clock: {
      device_time: now.toISOString(),
      // GNSS time is not exposed separately on this stack; the fix time is in
      // location.fix_time. Clock-skew detection is EVD-06 (Phase 2).
      gnss_time: null,
      skew_s: null,
      monotonic_ms: Math.round(performance.now()),
    },
    integrity: {
      rooted: isRooted(),
      mock_location: location?.mocked ?? null,
      clock_skew: null,
      location_unavailable: location === null,
    },
  };
}
