import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  generateKeyPair,
  publicKeyFromPrivateKey,
  publicKeyToJwk,
  sha256Hex,
  signPayload,
} from "@fdtc/evidence-core";
import { referenceDbPayload, type ReferenceDbBody, type SignedReferenceDb } from "../src/index";

/** Builds and signs the Reference DB (ARCHITECTURE §12).
 *
 * The private key stays on the build machine and is gitignored; only the public
 * key ships with the app. The app re-derives these exact bytes at start-up and
 * refuses to run a test if the signature does not verify (EVD-07). */

const KEY_ID = "agency_refdb_2026";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const sourcePath = resolve(packageRoot, "src/refdb.source.json");
const keyPath = resolve(packageRoot, "keys/agency-refdb.private.json");
const distDir = resolve(packageRoot, "dist");
// The mobile app bundles the signed DB and the agency public key (never the private key).
const appDir = resolve(packageRoot, "../../apps/mobile/src/refdb");

function loadOrCreateSigningKey(): Uint8Array {
  if (existsSync(keyPath)) {
    const stored = JSON.parse(readFileSync(keyPath, "utf8")) as { private_key: string };
    return base64UrlToBytes(stored.private_key);
  }

  const { privateKey } = generateKeyPair();
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(
    keyPath,
    JSON.stringify({ key_id: KEY_ID, private_key: bytesToBase64Url(privateKey) }, null, 2) + "\n"
  );
  console.log(`Generated a new agency signing key at ${keyPath}`);
  console.log("This file is gitignored. Keep it — rebuilding with a different key invalidates every shipped app.");
  return privateKey;
}

const body = JSON.parse(readFileSync(sourcePath, "utf8")) as ReferenceDbBody;
if (body.simulated !== true) {
  throw new Error("refusing to build: the demo Reference DB must be marked simulated");
}

const privateKey = loadOrCreateSigningKey();
const publicKey = publicKeyFromPrivateKey(privateKey);

const payload = referenceDbPayload(body);
const signed: SignedReferenceDb = { ...body, signature: signPayload(payload, privateKey, KEY_ID) };

mkdirSync(distDir, { recursive: true });
writeFileSync(resolve(distDir, "refdb.signed.json"), JSON.stringify(signed, null, 2) + "\n");
writeFileSync(
  resolve(distDir, "agency-refdb.pub.json"),
  JSON.stringify({ key_id: KEY_ID, jwk: publicKeyToJwk(publicKey) }, null, 2) + "\n"
);

mkdirSync(appDir, { recursive: true });
writeFileSync(resolve(appDir, "refdb.signed.json"), JSON.stringify(signed, null, 2) + "\n");
writeFileSync(
  resolve(appDir, "agency-refdb.pub.json"),
  JSON.stringify({ key_id: KEY_ID, jwk: publicKeyToJwk(publicKey) }, null, 2) + "\n"
);

console.log(`Reference DB  ${body.refdb_version}`);
console.log(`  kits        ${Object.keys(body.kits).join(", ")}`);
console.log(`  sha256      ${sha256Hex(payload)}`);
console.log(`  signed by   ${KEY_ID}`);
console.log(`  written to  ${distDir}`);
console.log(`  bundled in  ${appDir}`);
