import { p256 } from "@noble/curves/nist.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { sha256Hex } from "./hash";
import { bytesToBase64Url, base64UrlToBytes } from "./base64url";

export interface KeyPair {
  privateKey: Uint8Array; // 32 bytes
  publicKey: Uint8Array; // 65 bytes, uncompressed SEC1 (0x04 || X || Y)
}

/** New P-256 device key pair. Randomness comes from the platform CSPRNG
 * (Android Keystore / iOS Secure Enclave are the future upgrade path; the
 * prototype generates it in JS via @noble/curves + platform getRandomValues). */
export function generateKeyPair(): KeyPair {
  const privateKey = p256.utils.randomSecretKey();
  const publicKey = p256.getPublicKey(privateKey, false);
  return { privateKey, publicKey };
}

export function publicKeyFromPrivateKey(privateKey: Uint8Array): Uint8Array {
  return p256.getPublicKey(privateKey, false);
}

/** key_id = "k_" + base64url(SHA-256(uncompressed public key))[0..16] (ARCHITECTURE §9). */
export function keyIdFromPublicKey(publicKey: Uint8Array): string {
  const hashBytes = hexToBytes(sha256Hex(publicKey));
  return "k_" + bytesToBase64Url(hashBytes).slice(0, 16);
}

/** P-256 public key as a JWK — the form the key registry publishes (ARCHITECTURE §10.2). */
export interface EcJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

export function publicKeyToJwk(publicKey: Uint8Array): EcJwk {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error("expected a 65-byte uncompressed SEC1 P-256 public key");
  }
  return {
    kty: "EC",
    crv: "P-256",
    x: bytesToBase64Url(publicKey.slice(1, 33)),
    y: bytesToBase64Url(publicKey.slice(33, 65)),
  };
}

export function jwkToPublicKey(jwk: EcJwk): Uint8Array {
  if (jwk?.kty !== "EC" || jwk?.crv !== "P-256") {
    throw new Error("expected an EC P-256 JWK");
  }
  const x = base64UrlToBytes(jwk.x);
  const y = base64UrlToBytes(jwk.y);
  if (x.length !== 32 || y.length !== 32) {
    throw new Error("JWK x/y must be 32 bytes each");
  }
  const publicKey = new Uint8Array(65);
  publicKey[0] = 0x04;
  publicKey.set(x, 1);
  publicKey.set(y, 33);
  return publicKey;
}

/** device_id = "dev_" + SHA-256(public key)[0..6] uppercase hex (matches the
 * "dev_7F3A9C" shape in ARCHITECTURE §7.3). Derived, so it cannot be spoofed
 * independently of the key. */
export function deviceIdFromPublicKey(publicKey: Uint8Array): string {
  return "dev_" + sha256Hex(publicKey).slice(0, 6).toUpperCase();
}
