import canonicalize from "canonicalize";

/** RFC 8785 JSON Canonicalization Scheme. One exact byte form for a record,
 * so the app, verify.html and the mock server all hash the same bytes. */
export function canonicalizeRecord(record: unknown): string {
  const json = canonicalize(record);
  if (json === undefined) {
    throw new Error("record contains a value that cannot be canonicalized (undefined/function/symbol)");
  }
  return json;
}

export function toUtf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
