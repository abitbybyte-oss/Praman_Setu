import * as ExpoCrypto from 'expo-crypto';

/** @noble/curves draws key material from `crypto.getRandomValues`, which Hermes
 * does not provide. Bridge it to the platform CSPRNG that expo-crypto exposes
 * (ARCHITECTURE §9: "Randomness from expo-crypto getRandomValues").
 *
 * Imported for its side effect from the root layout, so it runs before any
 * screen can ask for a device key. */

type MutableGlobal = typeof globalThis & { crypto?: Partial<Crypto> };

const globals = globalThis as MutableGlobal;
if (!globals.crypto) globals.crypto = {};

if (typeof globals.crypto.getRandomValues !== 'function') {
  globals.crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
    if (!array) return array;
    const random = ExpoCrypto.getRandomBytes(array.byteLength);
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(random);
    return array;
  }) as Crypto['getRandomValues'];
}
