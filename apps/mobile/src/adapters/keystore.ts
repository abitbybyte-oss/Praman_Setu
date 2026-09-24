import * as SecureStore from 'expo-secure-store';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  deviceIdFromPublicKey,
  generateKeyPair,
  keyIdFromPublicKey,
  publicKeyFromPrivateKey,
  signPayload,
  type Es256Signature,
} from '@fdtc/evidence-core';

/** Device key storage (ARCHITECTURE §9).
 *
 * The private key is generated in JS and held in expo-secure-store, which is
 * Keychain-backed on iOS and Keystore-encrypted on Android. The upgrade path is
 * a non-exportable hardware key: only this module changes, the record format
 * does not. */

const PRIVATE_KEY_ITEM = 'fdtc.device.private_key';

export interface DeviceIdentity {
  publicKey: Uint8Array;
  keyId: string;
  deviceId: string;
}

let cachedPrivateKey: Uint8Array | null = null;

async function loadPrivateKey(): Promise<Uint8Array> {
  if (cachedPrivateKey) return cachedPrivateKey;

  const stored = await SecureStore.getItemAsync(PRIVATE_KEY_ITEM);
  if (stored) {
    cachedPrivateKey = base64UrlToBytes(stored);
    return cachedPrivateKey;
  }

  const { privateKey } = generateKeyPair();
  await SecureStore.setItemAsync(PRIVATE_KEY_ITEM, bytesToBase64Url(privateKey), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  cachedPrivateKey = privateKey;
  return privateKey;
}

export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  const privateKey = await loadPrivateKey();
  const publicKey = publicKeyFromPrivateKey(privateKey);
  return {
    publicKey,
    keyId: keyIdFromPublicKey(publicKey),
    deviceId: deviceIdFromPublicKey(publicKey),
  };
}

/** Signing never exposes the private key to callers — the closest this
 * prototype gets to the hardware-key behaviour it will eventually have. */
export async function sign(payload: Uint8Array, keyId: string): Promise<Es256Signature> {
  return signPayload(payload, await loadPrivateKey(), keyId);
}

/** Load the key ahead of a ledger append, so the append itself can run as one
 * synchronous SQLite transaction with no awaits inside it. */
export async function prepareSigner(): Promise<DeviceIdentity> {
  return getDeviceIdentity();
}

export function signSync(payload: Uint8Array, keyId: string): Es256Signature {
  if (!cachedPrivateKey) throw new Error('device key not loaded; call prepareSigner() first');
  return signPayload(payload, cachedPrivateKey, keyId);
}
