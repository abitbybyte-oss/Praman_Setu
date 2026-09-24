import * as SecureStore from 'expo-secure-store';

import { audit, getSetting, setSetting } from '../adapters/db';
import { getDeviceIdentity } from '../adapters/keystore';
import { allEnvelopes } from './ledger';

/** SYN-01: register this device's key with the agency registry
 * (ARCHITECTURE §9, §10.2). The GENESIS record is the registration request:
 * it is self-signed, so the server can check the device holds the key.
 * Offline, registration stays pending and is retried whenever Home opens —
 * records signed before registration still verify (the verifier notes when
 * the key was registered). */

const URL_KEY = 'server_url';
const STATE_KEY = 'registration';
const TOKEN_ITEM = 'fdtc.device.token';
const TIMEOUT_MS = 8000;

export interface Registration {
  status: 'NOT_CONFIGURED' | 'PENDING' | 'REGISTERED';
  key_id: string | null;
  registered_at: string | null;
  server: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
}

export function serverUrl(): string | null {
  return getSetting(URL_KEY);
}

export function setServerUrl(url: string): void {
  const clean = url.trim().replace(/\/+$/, '');
  setSetting(URL_KEY, clean || null);
  // A different server has its own registry: register again there.
  const r = registration();
  if (r.server && r.server !== clean) setSetting(STATE_KEY, null);
}

export function registration(): Registration {
  const server = serverUrl();
  const stored = getSetting(STATE_KEY);
  const base: Registration = stored
    ? (JSON.parse(stored) as Registration)
    : { status: 'PENDING', key_id: null, registered_at: null, server: null, last_attempt_at: null, last_error: null };
  if (!server) return { ...base, status: base.status === 'REGISTERED' ? 'REGISTERED' : 'NOT_CONFIGURED' };
  if (base.status === 'REGISTERED' && base.server !== server) return { ...base, status: 'PENDING' };
  return base;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Reachability check for the Settings screen. */
export async function pingServer(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetchWithTimeout(`${url.trim().replace(/\/+$/, '')}/health`);
    const body = (await res.json()) as { ok?: boolean; service?: string };
    return { ok: res.ok && body.ok === true, detail: body.service ?? String(res.status) };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Register now. Never throws: the outcome is recorded in the returned state. */
export async function registerDevice(badgeId: string): Promise<Registration> {
  const server = serverUrl();
  if (!server) return registration();
  const identity = await getDeviceIdentity();
  const genesis = allEnvelopes()[0];
  const now = new Date().toISOString();
  let next: Registration;
  try {
    const res = await fetchWithTimeout(`${server}/v1/devices/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ envelope: genesis, badge_id: badgeId }),
    });
    const body = (await res.json()) as { key_id?: string; registered_at?: string; device_token?: string; error?: string; detail?: string };
    if (!res.ok || body.key_id !== identity.keyId) throw new Error(`${body.error ?? res.status} ${body.detail ?? ''}`.trim());
    if (body.device_token) await SecureStore.setItemAsync(TOKEN_ITEM, body.device_token);
    next = { status: 'REGISTERED', key_id: body.key_id, registered_at: body.registered_at ?? now, server, last_attempt_at: now, last_error: null };
    audit('KEY_REGISTERED', `${server} ${body.key_id}`);
  } catch (e) {
    const message = e instanceof Error ? (e.name === 'AbortError' ? 'server did not answer' : e.message) : String(e);
    next = { ...registration(), status: 'PENDING', server, last_attempt_at: now, last_error: message };
  }
  setSetting(STATE_KEY, JSON.stringify(next));
  return next;
}

/** Called when Home opens: registers if a server is set and it is still pending. */
export async function ensureRegistered(badgeId: string): Promise<Registration> {
  const r = registration();
  return r.status === 'PENDING' ? registerDevice(badgeId) : r;
}
