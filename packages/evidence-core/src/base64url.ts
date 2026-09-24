const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Dependency-free base64url (no padding) encode/decode. Works identically in
 * Hermes (React Native), Node and browsers, so the same bytes always produce
 * the same string on every platform this code runs on. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let base64 = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    base64 +=
      ALPHABET[(chunk >> 18) & 63] +
      ALPHABET[(chunk >> 12) & 63] +
      ALPHABET[(chunk >> 6) & 63] +
      ALPHABET[chunk & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const chunk = bytes[i] << 16;
    base64 += ALPHABET[(chunk >> 18) & 63] + ALPHABET[(chunk >> 12) & 63];
  } else if (remaining === 2) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8);
    base64 +=
      ALPHABET[(chunk >> 18) & 63] +
      ALPHABET[(chunk >> 12) & 63] +
      ALPHABET[(chunk >> 6) & 63];
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_");
}

export function base64UrlToBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atobPolyfill(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function atobPolyfill(base64: string): string {
  if (typeof atob === "function") return atob(base64);
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const char of base64) {
    if (char === "=") break;
    const value = ALPHABET.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}
