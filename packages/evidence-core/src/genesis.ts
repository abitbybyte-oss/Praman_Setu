import { deviceIdFromPublicKey, keyIdFromPublicKey, publicKeyToJwk, type EcJwk } from "./keys";

/** GENESIS is seq 0 of every device chain and the only record that carries the
 * device public key (ARCHITECTURE §7.1, §9). It is self-signed: it proves the
 * device holds the private key, but not that the agency issued it — that comes
 * from registering it with the key registry. */
export interface GenesisRecord {
  schema: "fdtc.genesis/1";
  record_type: "GENESIS";
  record_id: string;
  device_id: string;
  key_id: string;
  seq: 0;
  prev_hash: null;
  created_at: string;
  simulated: true;
  public_key: EcJwk;
  app: { version: string; platform: string };
}

export function buildGenesisRecord(options: {
  publicKey: Uint8Array;
  recordId: string;
  createdAt: string;
  appVersion: string;
  platform: string;
}): GenesisRecord {
  return {
    schema: "fdtc.genesis/1",
    record_type: "GENESIS",
    record_id: options.recordId,
    device_id: deviceIdFromPublicKey(options.publicKey),
    key_id: keyIdFromPublicKey(options.publicKey),
    seq: 0,
    prev_hash: null,
    created_at: options.createdAt,
    simulated: true,
    public_key: publicKeyToJwk(options.publicKey),
    app: { version: options.appVersion, platform: options.platform },
  };
}
