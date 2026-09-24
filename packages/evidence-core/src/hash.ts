import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes as nobleHexToBytes } from "@noble/hashes/utils.js";

/** Lowercase hex SHA-256, so anyone can check it with sha256sum or certutil -hashfile. */
export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export function sha256Bytes(bytes: Uint8Array): Uint8Array {
  return sha256(bytes);
}

export function hexToBytes(hex: string): Uint8Array {
  return nobleHexToBytes(hex);
}
