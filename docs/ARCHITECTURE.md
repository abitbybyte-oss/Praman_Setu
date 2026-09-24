System Architecture
Field Drug Test Companion · Architecture v1.0 · 2026-09-22 · Status: Draft for team review

Source specification	
Project path document
Companion document	PRD.md
Scope	Hackathon prototype: mobile app, mock agency server, standalone verifier
Presumptive only. FDTC produces a presumptive field-test result and a supporting digital record. It does not replace laboratory confirmatory testing. All demo builds and materials are labelled "SIMULATED — NOT A DRUG TEST".

1. Architectural drivers
These quality attributes decide every trade-off below. When two conflict, the one higher up wins.

#	Driver	What it means in practice
D1	Evidential integrity	Any change to a saved record or its image must be detectable by someone who does not trust the app.
D2	Independent verifiability	A third party (lab, court, defence) can verify a record with a static web page and public data, without the app or the server.
D3	Offline-first	A full test, including signing and saving, works with no network. Sync is best-effort and never blocks evidence capture.
D4	Deterministic measurement	Same image + same taps + same Reference DB → same result, on any device. All thresholds are versioned data, not code.
D5	Honest uncertainty	When the measurement is weak, the system says Inconclusive with reasons, rather than guessing.
D6	Buildable by a small team	Prefer first-party/managed modules and pure-TypeScript cores that can be unit-tested in Node.
2. Principles
Originals are immutable. The captured JPEG is written once and hashed as written. All processing happens on a separate working copy.
The ledger is append-only. Nothing is edited or deleted. Corrections, voids, reviews and custody events are new signed records that point to the old one.
One implementation of the rules. Colour maths and evidence logic live in shared pure-TS packages used by the app, the verifier and the server.
Record everything that could be cherry-picked. Every capture's hash is in the final record, including rejected ones.
Flag, don't hide. Integrity signals (rooted device, mock GPS, clock skew, capture outside window) are recorded in the signed record and shown by the verifier. They never silently change a result.
Thresholds are data. Every cut-off lives in the signed Reference DB, whose hash is stored in each record.
3. System context
flowchart LR
  officer(["Field officer"])
  supervisor(["Supervisor"])
  verifier(["Verifier<br/>lab · court · defence"])
  app["FDTC mobile app<br/>offline-first"]
  server["Mock agency server<br/>key registry · ledger sync"]
  verify["verify.html<br/>static verifier"]

  officer -- "runs tests" --> app
  supervisor -- "reviews records" --> app
  app -- "register device key<br/>sync ledger + images" --> server
  app -- "exports JSON + image + PDF" --> verifier
  verifier -- "loads bundle" --> verify
  verify -- "fetches public key registry" --> server
Actor / system	Trust level	Notes
Field officer	Authenticated (mock PIN)	Performs tests. Could be motivated to alter results — the design assumes this.
Supervisor	Authenticated (mock PIN)	Reviews records. Cannot modify them; reviews are separate signed records.
Mobile app	Semi-trusted	Runs on a device the officer controls. Integrity comes from signatures + external anchoring, not from trusting the device.
Mock agency server	Trusted (prototype)	Holds the public key registry and acts as a time-and-sequence witness when records sync.
verify.html	Untrusted input, trusted code	Static page; verifies everything from first principles.
4. Containers
flowchart TB
  subgraph Mobile["Mobile app · Expo dev build · TypeScript"]
    UI["Screens<br/>expo-router"]
    WF["Test workflow<br/>state machine"]
    subgraph Services["App services"]
      CAP["Capture + quality"]
      CAL["Calibration + card check"]
      CLS["Classification"]
      KIT["Kit + timer"]
      EVB["Evidence builder"]
      LED["Ledger"]
      SYN["Sync worker"]
      EXP["Export: PDF · ZIP · QR"]
      REV["Review + custody"]
    end
    subgraph Core["Shared pure-TS packages"]
      CC["color-core"]
      EC["evidence-core"]
    end
    subgraph Adapters["Platform adapters"]
      CAM["vision-camera"]
      SKIA["Skia decode"]
      LOC["expo-location"]
      KEY["expo-secure-store"]
      DB[("expo-sqlite")]
      FS[("Evidence files")]
    end
    REF[["Reference DB<br/>signed JSON"]]
  end

  subgraph Server["Mock agency server · Node + Fastify"]
    API["REST API"]
    SDB[("SQLite")]
  end

  subgraph Verifier["verify.html · single static file"]
    VUI["Verifier UI"]
    VEC["evidence-core"]
  end

  UI --> WF --> Services
  CAP --> CC
  CAL --> CC
  CLS --> CC
  EVB --> EC
  LED --> EC
  Services --> Adapters
  Services --> REF
  SYN -- "HTTPS JSON" --> API
  API --> SDB
  VUI --> VEC
  VUI -- "GET /v1/registry" --> API
Container	Tech	Responsibility
Mobile app	Expo SDK (dev build), React Native, TypeScript	Whole field workflow, local ledger, signing, export, sync.
color-core	Pure TypeScript, no RN deps	Colour conversions, CIEDE2000, colour-correction fit, patch sampling, quality metrics, classification. Takes an RGBA buffer; knows nothing about cameras.
evidence-core	Pure TypeScript + @noble/hashes, @noble/curves, canonicalize, zod	Record schemas, RFC 8785 canonicalisation, hashing, ES256 sign/verify, chain verification.
Mock agency server	Node, Fastify, better-sqlite3	Device key registry, ledger ingestion with chain checks, supervisor record queries, serves verify.html.
verify.html	Vite + TS, bundled into one self-contained HTML file	Verifies record hash, signature, key registration, image hash and chain. Works from file:// or any static host.
5. Mobile app internals
5.1 Layers
Layer	Contents	Rule
Screens	S-01 … S-10 from the spec	Only talk to the workflow machine and read-only queries. No maths, no crypto.
Workflow	Test state machine (XState v5), session store (Zustand)	Owns the test draft. Every transition persists the draft for crash recovery.
Services	Capture, Quality, Calibration, Classification, Kit, Timer, Evidence builder, Ledger, Sync, Export, Review	Orchestrate cores + adapters. Unit-testable with fake adapters.
Cores	color-core, evidence-core	Pure functions. 100% runnable in Node tests.
Adapters	Camera, image decode, location, secure key store, SQLite, file system, PDF, network, device integrity	Thin wrappers behind interfaces so services can be tested and platforms swapped.
5.2 Module map
Module	Responsibility	Key dependencies
auth	Badge + PIN login, optional biometric unlock, role routing, session timeout	expo-local-authentication, @noble/hashes (scrypt)
kit	Parse kit QR, look up kit profile in Reference DB, compute VALID / EXPIRED / UNRECOGNISED / NOT_YET_VALID	vision-camera code scanner
timer	Reaction timer from kit protocol; capture lock; window state; haptics	expo-haptics, monotonic clock
capture	Take photo, move original into evidence dir, hash it, create working copy	vision-camera, expo-file-system, expo-crypto, Skia
quality	Blur, clipping, glare metrics; quality score; hard gates	color-core
calibration	Patch sampling, colour-correction fit, card validation	color-core
classify	ROI measurement, nearest-class CIEDE2000, margin, uncertainty, inconclusive reasons, recommended action	color-core, Reference DB
evidence	Assemble record from draft, round numbers, validate schema	evidence-core
ledger	Append with chain + signature in one transaction; projections; chain self-audit	evidence-core, expo-sqlite, key store
sync	Outbox worker, backoff, anchoring, image upload	netinfo, fetch
export	PDF report, evidence ZIP, compact QR, share sheet	expo-print, fflate, qrcode, expo-sharing
review	Supervisor review and custody records (both are ledger appends)	ledger
integrity	Root/jailbreak, mock location, clock skew signals	jail-monkey, expo-location
refdb	Load and verify the signed Reference DB at start-up	evidence-core
5.3 Test workflow state machine
stateDiagram-v2
  [*] --> KitSelect
  KitSelect --> KitSelect: kit EXPIRED or UNRECOGNISED (blocked)
  KitSelect --> Timer: kit VALID
  Timer --> Capture: capture window open
  Capture --> Capture: hard quality gate failed (retake)
  Capture --> MarkPatches: quality gates passed
  MarkPatches --> Capture: retake
  MarkPatches --> MarkSample: CARD VALID
  MarkPatches --> EndInconclusive: CARD INVALID and End test
  MarkSample --> Capture: strong glare (retake)
  MarkSample --> EndInconclusive: End test
  MarkSample --> Result: ROI checks done
  Result --> Capture: Retake
  Result --> Saved: Save
  EndInconclusive --> Saved
  Saved --> [*]
Guards live in the machine: kitValid, windowOpen, hardGatesPassed, cardValid. The screens cannot skip a guard.
Captures after max_s are allowed but the machine sets forcedInconclusive = OUTSIDE_REACTION_WINDOW.
Abandonment: if the officer leaves after at least one capture, or the app is killed, the draft is recovered on next launch. The officer can resume or end, but ending writes an INCONCLUSIVE record with reason ABANDONED, so every capture hash is still accounted for.
The draft (test_draft table) is working state, not evidence. Evidence starts at the first capture file and becomes a record at Save.
6. Image and colour pipeline
flowchart LR
  A["takePhoto<br/>JPEG original"] --> B["Move into evidence dir<br/>write-once"]
  B --> C["SHA-256 of file bytes"]
  B --> D["Working copy<br/>orientation fixed · 1600 px<br/>RGBA buffer"]
  D --> E["Quality metrics<br/>blur · clipping · glare"]
  E --> F["6 patch taps<br/>median sampling"]
  F --> G["Fit affine colour matrix<br/>linear sRGB"]
  G --> H["Card validation<br/>hue · ramp · residual"]
  H --> I["ROI tap + radius<br/>corrected median to Lab"]
  I --> J["Classify<br/>CIEDE2000 nearest class<br/>margin + uncertainty"]
  J --> K["Result + reasons<br/>+ recommended action"]
6.1 Stages
Stage	Algorithm	Output stored in record
Capture	vision-camera takePhoto, JPEG (not HEIC). File is moved, never re-encoded. AE/AWB lock is best-effort only (§6.3).	captures[]: n, sha256, bytes, taken_at, accepted, reject_reasons
Hash	SHA-256 over exact file bytes via native digest (expo-crypto). Lowercase hex, so anyone can check it with sha256sum or certutil -hashfile.	evidence_image.sha256
Working copy	Skia decodes JPEG, applies EXIF orientation, downscales long side to 1600 px, readPixels → Uint8Array RGBA. Disposable.	working.scale, working.orientation
Blur	Grayscale, 3×3 Laplacian, variance over card and kit regions.	quality.components.sharpness
Clipping	Fraction of card/ROI pixels with any channel ≥ 254 or ≤ 1.	quality.components.clipping
Glare	In ROI: raw pixels with all channels ≥ 245 and high local contrast. Pale-sample exemption: if corrected ROI median has L* ≥ 85, chroma < 10 and clipped fraction < 0.5%, treat as clear sample, not glare.	measurement.glare_fraction
Patch sampling	Median over a k×k window (k ≈ 2% of card width, default 15 px on the working copy). Reject the tap if per-channel MAD exceeds a threshold ("tap nearer the centre of the patch").	calibration.patches[id] = {xy, rgb, mad} (xy in original pixel space)
Linearise	sRGB inverse companding (piecewise, γ≈2.4).	—
Colour correction	Least-squares 3×4 affine matrix M mapping measured linear RGB [r g b 1] to reference linear RGB for each patch, with a small ridge term. Card v1 has 6 patches (18 equations, 12 unknowns). Card v2 adds reagent-hue patches (§12).	calibration.matrix (12 numbers), model: "affine3x4"
Residual	Apply M to each patch, convert to Lab, CIEDE2000 against the card reference.	residual_de00_mean, residual_de00_max
Card validation	Checks in §6.2.	card_status, failed_checks[]
ROI	Circle (centre + radius slider). Apply M per pixel → per-channel median → XYZ (D65) → Lab. Spread = p90 CIEDE2000 of pixels to the median.	measurement.{roi, lab, spread_de00_p90, area_px}
Classification	§6.4	classification.*
6.2 Card validation checks
All thresholds come from refdb.cards[card_version].checks.

Check	Rule (on raw sampled values unless stated)	Catches
All marked	6 patches, all inside the image, not overlapping	Missed taps
Expected hue	Red: R > G, B. Green: G > R, B. Blue: B > R, G, each by a margin	Wrong tap order, wrong card
White not clipped	≤ 2% of white-patch pixels at 255 in any channel	Overexposure
Black not crushed	≤ 2% of black-patch pixels at 0 in any channel	Underexposure
Neutral ramp	Luminance: black < gray < white, with margins. After correction |a*|, |b*| < 8 for neutrals	Wrong patches, strong cast
Residual	Mean CIEDE2000 ≤ 3.0, max ≤ 6.0 (initial values)	Bad lighting, non-uniform illumination, printed-card drift
Card recognised	Card version (from card QR, or manual select in P0) exists in Reference DB	Unknown card
6.3 Why the design does not depend on exposure / white-balance lock
AE/AWB lock support varies by device, OS version and camera library version. The reference card is in the same frame as the sample, so both see the same exposure and white balance, and the per-image colour correction removes that cast. Locking is therefore requested when available (it reduces frame-to-frame drift) but correctness does not rely on it.

6.4 Classification
For kit profile k with outcome classes C₁…Cₙ, each with one or more exemplar Lab values and a radius r:

d(Cᵢ) = minimum CIEDE2000 from the ROI Lab to any exemplar of class Cᵢ.
d₁ = nearest class distance, d₂ = second-nearest different-outcome class distance.
Colour-match confidence (margin ratio, shown as %): conf = (d₂ − d₁) / (d₂ + d₁). It is 1.0 on an exemplar and 0 when equidistant. This is a rescaled form of d₂/(d₁+d₂) so the displayed range is 0–100%. It is not a probability that a drug is present, and the UI says "colour-match confidence".
Measurement uncertainty u = √(residual_mean² + (spread_p90 / 2)²).
Rules, in order. Every rule that fires adds a reason. The outcome is INCONCLUSIVE if any reason exists.
Rule	Reason code
Hard quality gate failed and officer ended test	IMAGE_BLURRY / EXCESSIVE_GLARE
Quality band POOR	POOR_LIGHTING or the dominant quality reason
Card INVALID	CARD_CALIBRATION_FAILED
area_px below minimum	REACTION_AREA_TOO_SMALL
spread_p90 > limit	MULTIPLE_COLOURS
d₁ > r	OUTSIDE_REFERENCE_RANGE
(d₂ − d₁) < 2u or conf < conf_min	MEASUREMENT_UNCERTAINTY_HIGH
Capture after max_s	OUTSIDE_REACTION_WINDOW
Test ended without Save after a capture	ABANDONED
This is a retest of an INCONCLUSIVE record and is also INCONCLUSIVE	REPEAT_ALSO_INCONCLUSIVE
Otherwise the outcome is the nearest class's outcome: PRELIMINARY_POSITIVE or PRELIMINARY_NEGATIVE.
The recommended action is the most severe action implied by any reason (PRD §8.2): PRESERVE_FOR_LAB > REPEAT_TEST > RETAKE_PHOTO.
Optional baseline mode (P2): a baseline photo is taken at timer start. ΔE00(baseline ROI, reaction ROI) is stored. A negative class match with baseline change below no_reaction_de00 gets higher confidence. A positive match with no measurable change adds MEASUREMENT_UNCERTAINTY_HIGH.

6.5 Quality score
score = round(100 × Σ wᵢ · sᵢ), where each component sᵢ ∈ [0, 1] is a clamped linear ramp between a "bad" and a "good" threshold from the Reference DB.

Component	Weight	Ramp input
Sharpness	0.25	Laplacian variance
Exposure / clipping	0.15	Clipped fraction in card + ROI
Glare	0.20	ROI glare fraction
Calibration residual	0.15	Mean CIEDE2000
ROI uniformity	0.10	p90 spread
ROI area	0.05	area_px vs minimum
Card confidence	0.10	Fraction of card checks passed, weighted by margin
Bands: GOOD 80–100, FAIR 60–79, POOR < 60. Hard gates override the score: severe blur, glare ≥ hard limit, or CARD INVALID force a retake or an Inconclusive end regardless of the score. The top 3 reasons are the components with the largest weighted shortfall.

7. Evidence model
7.1 Record types
All records share the same envelope, chain and signature. They differ only in payload.

Type	Created when	Points to
GENESIS	First launch. Carries the device public key. seq = 0.	—
TEST	Save on the result screen, or an Inconclusive end, or recovery of an abandoned test	retest_of (optional)
VOID	Officer voids a record (replaces the spec's swipe-delete)	target record_id + record_hash
REVIEW	Supervisor sets REVIEWED / REQUIRES_RETEST / REQUIRES_LAB_CONFIRMATION	target record_id + record_hash
CUSTODY	Sample sealed, handed over, received (P2)	target record_id + record_hash
References always carry both record_id and record_hash, so a reference cannot silently point at a different version.

7.2 Envelope
{
  "fdtc_envelope": 1,
  "record": { "...": "payload, see 7.3" },
  "record_hash": "9f2c…64 hex chars",
  "signature": { "alg": "ES256", "key_id": "k_3QmZ…", "value": "base64url(r‖s), 64 bytes" }
}
7.3 TEST record (schema fdtc.test/1, abridged)
{
  "schema": "fdtc.test/1",
  "record_type": "TEST",
  "record_id": "0192a5c4-7e1b-7c3a-9f10-2b6d8e4f1a77",
  "device_id": "dev_7F3A9C",
  "key_id": "k_3QmZq8R1xV0bT2nL",
  "seq": 42,
  "prev_hash": "c1d8…",
  "created_at": "2026-09-22T10:14:03.221Z",
  "simulated": true,
  "source": "CAMERA",
  "operator": { "badge_id": "1234", "role": "OFFICER", "auth_method": "PIN" },
  "case": { "case_id": "FIR-0419-2026", "witness_badge_id": null },
  "kit": {
    "kit_id": "SIMKIT-000871", "kit_type": "SIM-A", "manufacturer": "Demo Labs",
    "batch": "B2026-07", "mfg_date": "2026-01-10", "expiry_date": "2027-01-10",
    "status": "VALID", "qr_sha256": "5e0a…"
  },
  "timing": {
    "timer_start": "2026-09-22T10:10:59.004Z", "capture_time": "2026-09-22T10:13:21.870Z",
    "elapsed_s": 142.9, "required_s": 120, "max_s": 300, "in_window": true
  },
  "captures": [
    { "n": 1, "sha256": "aa91…", "bytes": 2841123, "taken_at": "…", "accepted": false, "reject_reasons": ["IMAGE_BLURRY"], "quality_score": 41 },
    { "n": 2, "sha256": "4be7…", "bytes": 2903311, "taken_at": "…", "accepted": true, "reject_reasons": [], "quality_score": 92 }
  ],
  "evidence_image": { "n": 2, "sha256": "4be7…", "mime": "image/jpeg", "width": 4032, "height": 3024 },
  "calibration": {
    "card_version": "FDTC-CARD-1", "model": "affine3x4",
    "patches": { "white": { "xy": [812, 1440], "rgb": [231, 229, 224], "mad": 1.2 } },
    "matrix": [1.08, -0.04, 0.01, 0.002, "…12 values"],
    "residual_de00_mean": 1.84, "residual_de00_max": 3.12,
    "card_status": "VALID", "failed_checks": []
  },
  "measurement": {
    "roi": { "x": 2210, "y": 1502, "r": 64 }, "lab": [48.21, 38.7, -22.05],
    "spread_de00_p90": 2.31, "area_px": 12868, "glare_fraction": 0.001
  },
  "quality": {
    "score": 92, "band": "GOOD",
    "components": { "sharpness": 0.97, "clipping": 1.0, "glare": 0.98, "residual": 0.86, "uniformity": 0.9, "area": 1.0, "card": 0.95 },
    "reasons": []
  },
  "classification": {
    "algorithm": "nearest-class-de00/1", "outcome": "PRELIMINARY_POSITIVE",
    "class_id": "SIM-A-POS", "class_label": "Simulated colour A",
    "d1_de00": 4.21, "d2_de00": 18.93, "confidence": 0.636, "uncertainty_de00": 2.2,
    "inconclusive_reasons": [], "recommended_action": null
  },
  "location": {
    "lat": 28.613912, "lon": 77.209021, "accuracy_m": 8.0,
    "fix_time": "2026-09-22T10:13:20.000Z", "provider": "gps", "mocked": false
  },
  "clock": {
    "device_time": "2026-09-22T10:13:21.870Z", "gnss_time": "2026-09-22T10:13:21.412Z",
    "skew_s": 0.46, "monotonic_ms": 5543210
  },
  "integrity": { "rooted": false, "mock_location": false, "clock_skew": false, "location_unavailable": false },
  "reference_db": { "version": "2026.09-demo-1", "sha256": "71c3…" },
  "retest_of": null,
  "retake_count": 1,
  "app": { "version": "0.3.0", "build": "a1b2c3d", "platform": "android 14" }
}
7.4 Canonicalisation and number policy
payload bytes = UTF-8(JCS(record)), using RFC 8785 via the canonicalize package. Used identically by the app, verifier and server.
Numbers are rounded before assembly: Lab and ΔE 2 dp, confidence 3 dp, lat/lon 6 dp, seconds 1 dp, matrix 5 dp. Scores are integers. No NaN, Infinity or undefined (the zod schema rejects them). This keeps a future non-JS verifier (for example Python) byte-identical.
Timestamps are ISO 8601 UTC with milliseconds and Z.
Hashes are lowercase hex. Signatures and keys are base64url without padding.
7.5 Hashing, signing, chain
payload      = UTF-8( JCS(record) )          // record includes seq + prev_hash
record_hash  = hex( SHA-256(payload) )
signature    = ES256( device_private_key, payload )   // ECDSA P-256 over SHA-256(payload)
               encoded as 64-byte r‖s (IEEE P1363), base64url
chain rule   : record[n].prev_hash == record[n-1].record_hash,  seq contiguous from 0
Algorithm choice (ADR-04): ECDSA P-256 is supported by Android Keystore, iOS Secure Enclave, WebCrypto and Node. That keeps the hardware-key upgrade path open, and the verifier can be cross-checked against an independent implementation.
Signature format: 64-byte r‖s is what WebCrypto and @noble/curves use. Android/Java APIs emit DER, so any future native signer must convert. A shared test vector guards this.
Verifying from the PDF's QR alone: ES256 signs SHA-256(payload), which is exactly the record_hash digest. A verifier holding only (record_hash, signature, public key) can therefore check the signature with a raw-digest ECDSA verify (@noble/curves with prehashing disabled). This proves the device signed that hash. Matching the hash to the printed fields still needs the JSON.
Chain scope: one chain per device. A multi-device agency view is the union of device chains, anchored by the server.
External anchoring: on each sync the server stores the device's latest (seq, record_hash, server_received_at). After that, rewriting history on the device is detectable. Tail truncation before first sync is the main residual risk (§13).
7.6 Save transaction
sequenceDiagram
  participant UI as Result screen
  participant EB as Evidence builder
  participant L as Ledger
  participant K as Key store
  participant DB as SQLite
  UI->>EB: save(draft)
  EB->>EB: assemble record, round numbers, zod validate
  EB->>L: append(record)
  L->>DB: BEGIN IMMEDIATE, read head (seq, record_hash)
  L->>L: set seq and prev_hash from head
  L->>L: payload = JCS(record), record_hash = SHA-256(payload)
  L->>K: sign(payload) with ES256
  K-->>L: signature r‖s
  L->>DB: INSERT ledger, test_index, sync_outbox, then COMMIT
  L-->>UI: saved(record_id, record_hash)
BEGIN IMMEDIATE serialises appends, so two saves can never claim the same seq.

8. Local storage
8.1 Schema
erDiagram
  LEDGER ||--o| TEST_INDEX : "projects to"
  LEDGER ||--|| SYNC_OUTBOX : "queued in"
  LEDGER ||--o{ EVIDENCE_FILE : "references"
  OPERATOR ||--o{ TEST_INDEX : "performed"
  LEDGER {
    integer seq PK
    text record_id UK
    text record_type
    text payload "JCS text exactly as hashed"
    text prev_hash
    text record_hash UK
    text signature
    text key_id
    text created_at
  }
  TEST_INDEX {
    text record_id PK
    text created_at
    text operator_badge
    text kit_type
    text case_id
    text outcome
    integer quality_score
    text retest_of
    integer voided
    text review_status
  }
  SYNC_OUTBOX {
    text record_id PK
    text status
    integer attempts
    text next_attempt_at
    text last_error
    text server_received_at
  }
  EVIDENCE_FILE {
    text sha256 PK
    text record_id
    text kind
    text path
    integer bytes
    integer accepted
  }
  OPERATOR {
    text badge_id PK
    text name
    text role
    text pin_hash
    text pin_salt
  }
CREATE TABLE ledger (
  seq          INTEGER PRIMARY KEY,
  record_id    TEXT NOT NULL UNIQUE,
  record_type  TEXT NOT NULL CHECK (record_type IN ('GENESIS','TEST','VOID','REVIEW','CUSTODY')),
  payload      TEXT NOT NULL,
  prev_hash    TEXT,
  record_hash  TEXT NOT NULL UNIQUE,
  signature    TEXT NOT NULL,
  key_id       TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

CREATE INDEX idx_test_created  ON test_index(created_at DESC);
CREATE INDEX idx_test_case     ON test_index(case_id);
CREATE INDEX idx_test_filters  ON test_index(outcome, kit_type, operator_badge);
Other tables: test_draft (crash-recovery state, not evidence), audit_log (app events such as logins and rejected kits, not evidence), sync_anchor (last server-acknowledged head).

The triggers protect against app bugs. They do not stop a rooted attacker, who can drop them. The chain, signatures and server anchor provide the actual tamper-evidence.
test_index is a projection: it is derived and mutable (for example voided, review_status) and can be rebuilt from ledger at any time with "Rebuild index". Search and filters run against it.
8.2 File layout
<documentDirectory>/
  evidence/<record_id>/capture-01-<sha8>.jpg    original, write-once, never re-encoded
  evidence/<record_id>/baseline-<sha8>.jpg      P2 baseline mode
  work/<record_id>/working-01.png               downscaled working copy, disposable
  exports/<record_id>/report.pdf                regenerable
  exports/<record_id>/evidence.zip              regenerable
The record_id (UUIDv7) is assigned when the test draft starts, so files can be placed before the record exists.

9. Keys and identity
Item	Prototype	Upgrade path
Device key	P-256 key pair generated with @noble/curves on first launch. Randomness from expo-crypto getRandomValues.	Non-exportable key in Secure Enclave or StrongBox via a native module, with key attestation sent at registration.
Private key storage	expo-secure-store: iOS Keychain, Android Keystore-encrypted storage. Optional biometric gate.	Hardware key: the private key never enters JS.
key_id	"k_" + base64url(SHA-256(uncompressed public key))[0..16]	Certificate serial from agency PKI
Registration	GENESIS record, self-signed, posted to /v1/devices/register with the logged-in badge. Works offline: queued like any record.	Agency PKI issues a device certificate. Revocation list.
Operator identity	Badge + PIN (scrypt hash, local mock directory). The badge is written into each record. The signature attests the device, not the person.	Per-operator keys or smart card, multi-officer co-signing.
Records signed before the key is registered still verify. The verifier shows "key registered at T, after this record was created" as a warning.

10. Sync and mock agency server
10.1 Outbox pattern
Every ledger append also inserts a sync_outbox row with status PENDING, inside the same transaction.
The worker runs on app foreground, on connectivity regained (NetInfo), and every 60 s while online.
It uploads in seq order. Idempotency key: record_hash.
Statuses: PENDING → SYNCING → SYNCED, or FAILED (retryable, exponential backoff 30 s → 30 min), or FAILED with CHAIN_CONFLICT (not retried automatically, raises an integrity alert).
Local evidence is never deleted by sync.
Images upload after their record (PUT /v1/evidence/:sha256). The server re-hashes the bytes and rejects a mismatch.
sequenceDiagram
  participant W as Sync worker
  participant DB as SQLite
  participant S as Mock server
  W->>DB: select PENDING and retryable FAILED, ordered by seq
  W->>S: POST /v1/ledger with envelopes
  S->>S: check signature, key registered, prev_hash equals stored head
  alt accepted or duplicate
    S-->>W: 200 with server_received_at per record
    W->>DB: mark SYNCED, store anchor head
  else chain conflict
    S-->>W: 409 CHAIN_CONFLICT
    W->>DB: mark FAILED without auto-retry, raise integrity alert
  else network error or 5xx
    W->>DB: mark FAILED, attempts plus one, schedule backoff
  end
10.2 API (v1)
Method + path	Auth	Purpose
POST /v1/devices/register	none (prototype)	Body: GENESIS envelope + badge. Returns key_id, registered_at, device token.
GET /v1/registry	public, CORS *	{generated_at, keys:[{key_id, device_id, jwk, status, registered_at, registered_by}]} for the verifier
POST /v1/ledger	device token	Batch of envelopes in seq order → per-record ACCEPTED, DUPLICATE or REJECTED with reason. 409 on chain conflict.
GET /v1/devices/:id/head	device token	Last anchored {seq, record_hash, server_received_at}
PUT /v1/evidence/:sha256	device token	Image upload. Server verifies the hash.
GET /v1/records	supervisor token	Filters: from, to, case_id, outcome, kit_type, operator, review_status
GET /v1/records/:record_id	supervisor token	Envelope + REVIEW, VOID and CUSTODY records that reference it
GET /verify	public	Serves verify.html
server_received_at is a third-party time witness. It is a lightweight stand-in for RFC 3161 trusted timestamps until those are added.

10.3 Supervisor flow
In a multi-device demo, the supervisor's app pulls synced records from /v1/records and shows them read-only. A review is a REVIEW record on the supervisor's own device chain, uploaded like any other record. In a single-device demo, the same app switches role at login and reads the local ledger.

11. Verifier (verify.html)
Inputs: an envelope JSON or a full ledger export, zero or more image files, and a key registry (fetched from the server URL or loaded as a file for fully offline verification). It also accepts a pasted or scanned PDF QR string.

flowchart TD
  A["Load envelope JSON"] --> B{"Schema valid?"}
  B -- no --> F1["FAIL: malformed record"]
  B -- yes --> C["Recompute SHA-256 of JCS record"]
  C --> D{"Equals record_hash?"}
  D -- no --> F2["FAIL: record content altered"]
  D -- yes --> E{"Registry loaded?"}
  E -- no --> W1["WARN: signer not checked"]
  E -- yes --> E2{"key_id registered and active?"}
  E2 -- no --> F5["FAIL: unknown or revoked signer"]
  E2 -- yes --> G{"ES256 signature valid?"}
  W1 --> G
  G -- no --> F3["FAIL: signature invalid"]
  G -- yes --> H{"Image provided?"}
  H -- yes --> I{"SHA-256 of file equals evidence_image.sha256?"}
  I -- no --> F4["FAIL: image altered or wrong image"]
  I -- yes --> J["Chain checks if ledger export"]
  H -- no --> J
  J --> K["Show integrity flags<br/>rooted · mock GPS · clock skew · window · card · quality"]
  K --> L["Overall: VERIFIED, VERIFIED WITH WARNINGS or FAILED"]
Chain checks on a ledger export: seq contiguous from 0, every prev_hash link holds, every signature is valid, and the head matches the server anchor when available. A missing row shows as a seq gap or a broken link, pointing at the exact position.
Void awareness: if the export contains a VOID for the record, show "VOIDED by badge X at T: reason". The record itself still verifies.
Implementation: the verifier uses the same evidence-core as the app (pure JS, so no secure-context or WebCrypto differences). CI also cross-verifies test vectors with Node's built-in crypto.verify (dsaEncoding: 'ieee-p1363') as an independent implementation.
Build: Vite + vite-plugin-singlefile → one verify.html with no external requests. Hosted at /verify on the mock server and on a static host (for example GitHub Pages) for judges.
12. Reference DB
A signed JSON bundle shipped with the app, verified at start-up. If the signature fails, the app refuses to start a test.

{
  "refdb_version": "2026.09-demo-1",
  "simulated": true,
  "cards": {
    "FDTC-CARD-1": {
      "patches": [
        { "id": "white", "lab": [95.0, -0.5, 2.0] },
        { "id": "black", "lab": [18.0, 0.3, -0.8] },
        { "id": "red",   "lab": [44.0, 60.0, 38.0] },
        { "id": "green", "lab": [55.0, -45.0, 30.0] },
        { "id": "blue",  "lab": [32.0, 15.0, -55.0] },
        { "id": "gray",  "lab": [55.0, 0.0, 0.5] }
      ],
      "checks": { "residual_mean_max": 3.0, "residual_max_max": 6.0, "neutral_ab_max": 8.0, "clip_frac_max": 0.02 }
    }
  },
  "kits": {
    "SIM-A": {
      "display_name": "Simulated Test A",
      "protocol": { "required_s": 120, "max_s": 300, "demo_required_s": 20,
                    "steps": ["Place sample", "Close pouch", "Break ampoule 1", "Agitate 10 s"] },
      "classes": [
        { "id": "SIM-A-POS", "outcome": "PRELIMINARY_POSITIVE", "label": "Simulated colour A",
          "exemplars_lab": [[48.0, 40.0, -22.0], [45.5, 43.0, -25.0]], "radius_de00": 15 },
        { "id": "SIM-A-NEG", "outcome": "PRELIMINARY_NEGATIVE", "label": "Simulated clear",
          "exemplars_lab": [[88.0, -1.0, 6.0]], "radius_de00": 12 }
      ]
    }
  },
  "thresholds": {
    "blur_lapvar_hard": 60, "blur_lapvar_good": 150,
    "glare_hard": 0.03, "glare_soft": 0.005,
    "roi_min_radius_frac": 0.01, "roi_spread_p90_max": 8.0,
    "conf_min": 0.25, "no_reaction_de00": 3.0
  },
  "quality_weights": { "sharpness": 0.25, "clipping": 0.15, "glare": 0.20, "residual": 0.15,
                       "uniformity": 0.10, "area": 0.05, "card": 0.10 },
  "signature": { "alg": "ES256", "key_id": "agency_refdb_2026", "value": "…" }
}
The values above are illustrative starting points. Real values come from measuring the printed card with a spectrophotometer (or averaged captures under D65-like light) and from the validation study.
The demo DB contains only simulated kit profiles (SIM-A…SIM-D stand in for "Test A–D"). No real reagent colour data is included or implied.
Card v2 (P1): adds reagent-hue patches (purple, orange, brown, dark blue), giving 12 patches for the fit, and a card QR carrying the print batch's measured Lab values.
Each TEST record stores reference_db.version and reference_db.sha256, so a changed threshold can never be applied retroactively without detection.
13. Threat model
Threat	Example	Mitigation	Residual risk
Alter a result	Change NEGATIVE to POSITIVE in the DB or JSON	record_hash + ES256 signature, verifier recomputes	None while the key is safe
Swap the image	Replace the photo with another one	Image SHA-256 inside the signed record	None
Delete an inconvenient record	DELETE FROM ledger on a rooted device	Append-only triggers, seq gap and prev_hash break, server anchor	Tail truncation before first sync is not detectable locally. Mitigate with frequent sync and seq numbers printed on PDFs.
Cherry-pick captures	Retake until the desired result appears	All capture hashes + retake_count in the record	Officer never captures at all. P2 baseline photo at timer start helps.
Forge with own key	Attacker signs a fake record with a new key	Verifier checks key_id against the agency registry	Registry compromise (future: PKI + revocation)
Backdate	Change the device clock	Device, GNSS and monotonic time recorded, skew flag, server receipt time	Offline with no GNSS fix: flag only
Fake location	Mock-location app	mocked flag, accuracy, fix age	A rooted device can hide mocking: the root flag is recorded
Steal the key	Root the device, read secure storage	Keystore/Keychain-backed storage, root flag	Real until hardware non-exportable keys + attestation
Change thresholds	Edit the Reference DB to shift outcomes	Signed Reference DB, its hash in every record	None
Replay or duplicate	Upload the same record twice	Idempotency on record_hash, unique (device_id, seq)	None
Inject a non-camera image	Use a gallery photo	Production builds capture from the camera only. source field. Fixture mode exists only in dev builds and marks source: "FIXTURE".	Photo of a photo (future: moiré or depth checks)
Expired kit accepted	Device date changed to before expiry	Kit status uses device time, and the clock-skew flag is shown next to kit status	Offline clock manipulation: flag only
14. Error handling and recovery
Situation	Behaviour
Camera permission denied	Cannot start a test. Screen explains how to grant it.
Location denied or no fix within 20 s	Test continues. location: null, integrity.location_unavailable: true, shown on result and verifier.
Secure key store unavailable	Tests blocked. A record that cannot be signed is not evidence.
Reference DB signature invalid	Tests blocked. "Reference data failed verification — reinstall the app."
Free storage < 200 MB	New tests blocked. Existing evidence untouched.
App killed mid-test	Draft restored on relaunch. Resume, or end as ABANDONED (Inconclusive).
Sync conflict (409)	Record stays local and FAILED with CHAIN_CONFLICT. Integrity alert on Home. Supervisor attention required.
Chain self-audit fails	Home shows a red integrity banner with the failing seq. Nothing is auto-repaired.
15. Technology choices
Concern	Choice	Rationale	Bare-RN equivalent from spec
Framework	Expo SDK, dev build + React Native + TypeScript	First-party SQLite, location, print, secure-store, crypto, haptics. Native libraries via config plugins.	React Native CLI
Navigation	expo-router	File-based, matches screen list	react-navigation
Workflow	XState v5	Guards and states are explicit and testable. The machine doubles as documentation.	useReducer
Session state	Zustand	Small, simple	Redux
Camera + QR scan	react-native-vision-camera (photo + code scanner)	As specified, one camera stack	same
Image decode, pixels, overlays	@shopify/react-native-skia	Decode JPEG, readPixels, draw tap markers and ROI circle	—
Pixel maths	color-core (TS) on the 1600 px working copy	Testable in Node. No native build risk. Laplacian on about 1.9 MP is fast enough.	OpenCV. Keep react-native-fast-opencv for ArUco later.
Database	expo-sqlite	Triggers, transactions, sync API	react-native-sqlite-storage
Files	expo-file-system	Move without re-encode, read bytes	react-native-fs
File hashing	expo-crypto digest (native)	Multi-MB images hash quickly	react-native-quick-crypto
Record hashing, signatures	@noble/hashes, @noble/curves (P-256)	Audited pure JS. Same code in app, verifier and server.	react-native-quick-crypto
Canonical JSON	canonicalize (RFC 8785)	Reference implementation	—
Key storage	expo-secure-store	Keychain / Keystore-backed	react-native-keychain
Biometrics	expo-local-authentication		react-native-biometrics
Location	expo-location (mocked flag on Android)		react-native-geolocation-service
Root / jailbreak	jail-monkey	Also reports mock-location capability	same family
Network state	@react-native-community/netinfo	Triggers sync	same
PDF	expo-print (HTML template → PDF) + expo-sharing	Templated report with embedded image and QR SVG	react-native-pdf / html-to-pdf
QR generate	react-native-qrcode-svg (screen), qrcode (SVG string for PDF)		same
ZIP	fflate	Pure JS	react-native-zip-archive
Schemas	zod	One schema for app, server, verifier	—
IDs	UUIDv7 (uuid)	Time-ordered, sortable	—
i18n	i18next + react-i18next	English + Hindi	—
Mock server	Node, Fastify, better-sqlite3	Small, fast to build	—
Verifier	Vite + TS + vite-plugin-singlefile	Output is plain HTML + JS, as specified	Plain HTML + JS
Tests	Vitest (packages), Jest (app), Maestro (E2E)		—
16. Repository layout
fdtc/
├─ apps/
│  ├─ mobile/                 Expo app
│  │  ├─ app/                 expo-router screens (login, home, test/*, history, verify, review)
│  │  └─ src/
│  │     ├─ workflow/         test machine, draft persistence
│  │     ├─ services/         capture, quality, calibration, classify, kit, timer,
│  │     │                    evidence, ledger, sync, export, review, integrity, refdb
│  │     ├─ adapters/         camera, image, location, keystore, db, fs, pdf, net
│  │     ├─ ui/               shared components, simulated-banner, status pills
│  │     └─ i18n/
│  ├─ verify/                 verify.html source → dist/verify.html
│  └─ mock-server/            Fastify API + SQLite, serves /verify
├─ packages/
│  ├─ color-core/             srgb, lab, ciede2000, ccm, sampling, quality, classify
│  ├─ evidence-core/          schemas, jcs, hash, es256, chain, verify
│  └─ refdb/                  source JSON + build-and-sign script
├─ tools/
│  ├─ validation-study/       CSV from app study mode → confusion matrix, kappa, charts
│  ├─ fixtures/               golden images + expected results, crypto test vectors
│  └─ demo/                   printable reference card, swatches, kit QR generator
└─ docs/
   ├─ PRD.md
   └─ ARCHITECTURE.md
Workspaces: npm workspaces, or pnpm with node-linker=hoisted (follow the Expo monorepo guide).

17. Testing architecture
Level	What	How
color-core unit	sRGB↔Lab round trip, CIEDE2000, CCM fit, blur, glare, classification rules	CIEDE2000 checked against the 34 published pairs (Sharma, Wu & Dalal, 2005). Synthetic images: known patches under a known colour cast + noise + gamma. CCM must recover them within ΔE00 < 1. Blur metric must fall monotonically with Gaussian σ.
evidence-core unit	JCS, hashing, sign/verify, chain	RFC 8785 examples. Sign/verify round trip. Cross-verify with Node crypto.verify (P1363). Mutation tests: flip any byte of payload or image, delete or reorder any record — verify must fail 100% of the time.
Golden pipeline	Fixture photo + stored taps → expected result	Run color-core headless in Node (decode with jpeg-js or sharp). Any change in outcome breaks CI.
App services	Ledger append, projection rebuild, sync state machine, workflow guards	Jest with fake adapters and in-memory SQLite
E2E	Login → kit → timer → capture → save → history → export	Maestro on an Android device. Camera steps use dev-build fixture mode (source: "FIXTURE").
Validation study	Accuracy across lighting and devices	App study mode (dev builds only): tester selects the true swatch before capture, and results export as CSV. tools/validation-study computes the confusion matrix, Inconclusive rate, lighting invariance and Cohen's κ vs a human panel.
18. Demo topology
flowchart LR
  phone["Android phone<br/>FDTC dev or preview build"]
  laptop["Laptop<br/>mock server :8080<br/>/verify"]
  pages["Static host<br/>verify.html for judges"]
  judge(["Judge"])
  phone -- "LAN Wi-Fi" --> laptop
  judge -- "opens" --> pages
  judge -- "or opens" --> laptop
Android first: mock-location and root signals are demonstrable there. iOS is optional.
Offline demo: switch the phone to airplane mode, run a test, turn the network back on, and show PENDING → SYNCED.
Fallback kit: fixture images, a pre-recorded screen capture, a desk lamp and a warm bulb for the lighting demo.
The demo Reference DB uses demo_required_s (for example 20 s), so the reaction timer fits the pitch. The record stores which protocol value was used.
19. Architecture decision records
ADR	Decision	Status
001	Expo (dev build) React Native with TypeScript	Proposed
002	Shared pure-TS color-core and evidence-core used by app, verifier and server	Proposed
003	Pixel maths in TS on a downscaled working copy. OpenCV deferred to ArUco detection.	Proposed
004	ES256 (ECDSA P-256), 64-byte r‖s, base64url	Proposed
005	RFC 8785 JCS canonicalisation. record_hash = hex(SHA-256(JCS(record))). Fixed number rounding.	Proposed
006	Append-only ledger enforced by triggers. Searchable projections are rebuildable.	Proposed
007	Per-device hash chain. Server acts as anchoring witness on sync.	Proposed
008	Originals immutable. Hash the file bytes as written.	Proposed
009	Correctness does not depend on AE/AWB lock. In-frame card calibration instead.	Proposed
010	Outbox sync, idempotent by record_hash. Chain conflicts are never auto-retried.	Proposed
011	Swipe-delete replaced by signed VOID records	Proposed
012	Affine 3×4 colour correction and CIEDE2000 replace white-patch gain and CIE76	Proposed
20. Evolution path
Future item	Where it plugs in
Hardware non-exportable keys + attestation	Replace the keystore adapter's signer. Attestation goes into GENESIS. Record format unchanged.
Agency PKI + revocation	Registry entries become certificates. The verifier checks the chain and the revocation list.
RFC 3161 trusted timestamps	Server requests a timestamp token for each anchored head and stores it alongside server_received_at.
Merkle / blockchain anchoring	Periodically publish a Merkle root of all anchored heads. The verifier checks an inclusion proof.
SQLCipher	Swap the SQLite adapter. Schema unchanged.
ArUco auto card detection	New color-core-adjacent detector (OpenCV). Replaces manual patch taps. Taps stay as a fallback.
On-device CNN classifier	An additional classification.algorithm value. The CIEDE2000 result is kept alongside for explainability.
Real backend (API gateway, PostgreSQL, S3)	Same v1 API contract. The mock server is the reference implementation.