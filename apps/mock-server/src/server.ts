import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  checkEnvelope,
  deviceIdFromPublicKey,
  jwkToPublicKey,
  keyIdFromPublicKey,
  type EcJwk,
  type Envelope,
} from "@fdtc/evidence-core";
import { findByKeyId, publicRegistry, upsert } from "./registry-store";

/** Mock agency server (ARCHITECTURE §10).
 *
 * Phase 0 scope is the half the verifier depends on: register a device key and
 * publish the registry. Ledger ingestion, evidence upload and the supervisor
 * queries are Phase 2 (SYN-01). */

const here = dirname(fileURLToPath(import.meta.url));
const verifierPath = resolve(here, "../../verify/dist/verify.html");
const port = Number(process.env.PORT ?? 8080);

const app = Fastify({ logger: true });

// The verifier is a static page that may be opened from file://, so it has no
// useful origin. The registry is public data by design (ARCHITECTURE §10.2).
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true, service: "fdtc-mock-server" }));

interface RegisterBody {
  envelope?: Envelope;
  badge_id?: string;
}

app.post("/v1/devices/register", async (request, reply) => {
  const { envelope, badge_id } = (request.body ?? {}) as RegisterBody;

  if (!envelope || typeof envelope !== "object") {
    return reply.code(400).send({ error: "BAD_REQUEST", detail: "expected a GENESIS envelope" });
  }

  const record = envelope.record as Record<string, unknown> | undefined;
  if (!record || record.record_type !== "GENESIS" || record.seq !== 0) {
    return reply.code(400).send({ error: "NOT_GENESIS", detail: "registration requires the device's seq 0 GENESIS record" });
  }

  const jwk = record.public_key as EcJwk | undefined;
  if (!jwk) {
    return reply.code(400).send({ error: "NO_PUBLIC_KEY", detail: "the GENESIS record carries no public key" });
  }

  let publicKey: Uint8Array;
  try {
    publicKey = jwkToPublicKey(jwk);
  } catch (error) {
    return reply.code(400).send({ error: "BAD_PUBLIC_KEY", detail: String(error) });
  }

  // The identifiers are derived from the key, so a device cannot claim someone
  // else's key_id or device_id.
  const derivedKeyId = keyIdFromPublicKey(publicKey);
  const derivedDeviceId = deviceIdFromPublicKey(publicKey);
  if (record.key_id !== derivedKeyId || record.device_id !== derivedDeviceId) {
    return reply.code(400).send({
      error: "IDENTITY_MISMATCH",
      detail: "key_id and device_id must be derived from the public key in the record",
    });
  }

  // Self-signed, which proves the device holds the matching private key.
  const signatureCheck = checkEnvelope(envelope, publicKey);
  if (!signatureCheck.ok) {
    return reply.code(400).send({ error: signatureCheck.reason, detail: "the GENESIS record did not verify" });
  }

  const { entry, created } = upsert({
    key_id: derivedKeyId,
    device_id: derivedDeviceId,
    jwk,
    status: "ACTIVE",
    registered_at: new Date().toISOString(),
    registered_by: typeof badge_id === "string" ? badge_id : undefined,
    device_token: randomBytes(24).toString("base64url"),
  });

  return reply.code(created ? 201 : 200).send({
    key_id: entry.key_id,
    device_id: entry.device_id,
    registered_at: entry.registered_at,
    device_token: entry.device_token,
    already_registered: !created,
  });
});

app.get("/v1/registry", async () => publicRegistry());

app.get("/v1/devices/:keyId", async (request, reply) => {
  const { keyId } = request.params as { keyId: string };
  const entry = findByKeyId(keyId);
  if (!entry) return reply.code(404).send({ error: "UNKNOWN_KEY" });
  const { device_token: _token, ...publicView } = entry;
  return publicView;
});

app.get("/verify", async (_request, reply) => {
  if (!existsSync(verifierPath)) {
    return reply
      .code(404)
      .type("text/plain")
      .send("verify.html has not been built yet. Run: npm run build --workspace @fdtc/verify");
  }
  return reply.type("text/html; charset=utf-8").send(readFileSync(verifierPath, "utf8"));
});

await app.listen({ port, host: "0.0.0.0" });
app.log.info(`verifier at http://localhost:${port}/verify · registry at http://localhost:${port}/v1/registry`);
