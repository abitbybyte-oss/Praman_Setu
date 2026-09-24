# Praman Setu (प्रमाण सेतु) — Field Drug Test Companion (FDTC)
### Development To-Do List
Compiled from `prd.md`, `system_architecture.txt`, and `Project path document.docx` · 2026-09-22

> **Deadline: prototype due Sunday 27 Sep 2026 — 5 days out.**
> Presumptive test only. Demo uses simulated materials only — no drugs, no real reagent kits. Every screen/record/printout: "SIMULATED — NOT A DRUG TEST".

---

## 0. Read this first — decisions that changed since the original spec

The `.docx` is the original plan; `prd.md` / `system_architecture.txt` record a later design review that **overrides** it in these places. Build to the right-hand column, not the left:

| Original (.docx) | Now (PRD/Architecture) | Why |
|---|---|---|
| Swipe-delete, "breaks chain" warning | Signed **VOID** record; original kept | Evidence must never be deleted |
| White-patch gain correction | **Affine 3×4 colour-correction matrix** from all 6 patches | Uses all calibration data, better accuracy |
| ΔE (CIE76) | **CIEDE2000** | Current standard, defensible under questioning |
| Confidence = closeness to nearest | **Margin ratio** (d₂−d₁)/(d₂+d₁) + uncertainty rule | Ambiguous colours auto-become Inconclusive |
| Only kept image hashed | **Every capture hashed**, listed in record | Prevents cherry-picking |
| Device time only | Device + GNSS + monotonic, skew flag | Device clock can be changed |
| Public key inside JSON | **Agency key registry** checked by verifier | Otherwise anyone can self-sign a forgery |
| Capture button turns green "on alignment" | Overlay is a guide; button enables when capture window opens. Auto-align is **Future** (ArUco) | Alignment detection needs card detection (not P0) |
| Exposure/WB lock required | **Best-effort only** — correctness comes from in-frame card | Lock support varies by device |

Golden rule from the PRD (§12): **when time runs short, cut P2 first, then P1 workflow. Never cut integrity items** (hashing, signing, chain, VOID, tamper detection) — they're the core of the proposal.

---

## 1. Phase 0 — Setup & spikes (do first, today/tomorrow)

- [x] Scaffold monorepo: `apps/mobile`, `apps/verify`, `apps/mock-server`, `packages/color-core`, `packages/evidence-core`, `packages/refdb`, `tools/`
- [x] Expo dev build running on the **actual demo phone** with vision-camera + Skia + SQLite — EAS dev build on the demo phone; vision-camera, Skia, SQLite smoke test 8/8
- [x] Spike: take a photo → hash it → sign it (ES256/P-256) in RN → verify the signature in plain Node (`crypto.verify`) and in a browser (verify.html stub) — signature verified with Node crypto.verify and in verify.html
- [x] Pin SDK / library versions (native build risk is the #1 architecture risk) — lockfile; SDK 57 / RN 0.86.3
- **Exit criteria:** a photo taken on the phone is hashed and signed, and the signature verifies in both `verify.html` and Node's `crypto.verify`.

---

## 2. Phase 1 — Core loop (P0) — the demo depends entirely on this

### Auth & Home
- [x] AUTH-01 Badge ID + PIN login against local mock operator directory; PINs as salted scrypt hashes
- [x] AUTH-02 Route by role: Officer → Home, Supervisor → Review list
- [x] HOME-01 Officer name/badge, Start New Test, View History
- [x] HOME-02 Persistent, non-dismissible "SIMULATED — NOT A DRUG TEST" banner

### Kit selection
- [x] KIT-01 Manual kit-type dropdown backed by simulated profiles (SIM-A…SIM-D)
- [x] KIT-02 Optional case ID/FIR + witness badge ID, pre-filled on repeat test

### Guided capture
- [x] CAP-01 Live preview with reference-card + kit guide rectangles
- [x] CAP-02 Save original JPEG **write-once**; SHA-256 over exact bytes before any processing
- [x] CAP-03 Blur hard gate (Laplacian variance) → "Image too blurry, retake"

### Calibration (6-patch tap)
- [x] CAL-01 Printed card FDTC-CARD-1 (`npm run card`): tap 4 corner markers TL → TR → BR → BL, patches located by homography, with undo/retake
- [x] CAL-02 Sample each patch as median of a k×k window; reject off-centre taps
- [x] CAL-03 Fit **affine 3×4** colour-correction matrix; compute residual CIEDE2000
- [x] CAL-04 Card validation checks (hue, white/black clipping, neutral ramp, residual, card recognised) → CARD VALID / CARD INVALID with failed checks listed
- [x] CAL-05 On CARD INVALID: Retake or End Test (saves Inconclusive, `CARD_CALIBRATION_FAILED`)

### Sample region & classification
- [x] ROI-01/02 Tap centre + adjustable radius → corrected median colour → Lab, p90 spread, area
- [x] Classification: nearest-class **CIEDE2000**, margin-ratio confidence, uncertainty rule → outcome or Inconclusive reason (architecture §6.4 rule table)

### Result & evidence record
- [x] RES-01–04 Outcome + confidence + ΔE00, card status, metadata (timestamp, GPS, operator, kit, case ID, Reference DB version)
- [x] RES-02 Demo wording only — e.g. "DEMO: Simulated Preliminary Positive — colour-match confidence 94%" — **never a substance name**
- [x] EVD-01 Assemble record to schema `fdtc.test/1`, zod-validated, numbers rounded per spec
- [x] EVD-02 Save transaction: `seq`/`prev_hash` → JCS canonicalise (RFC 8785) → `record_hash` = SHA-256 → ES256 sign → insert ledger+index+outbox in one transaction
- [x] EVD-03 GENESIS record (device public key, `seq=0`, self-signed) on first launch
- [x] EVD-05 Ledger append-only (SQLite triggers abort UPDATE/DELETE)

### History & export
- [x] HIS-01/02 History list (newest first) + read-only detail w/ hash, signature status, chain position
- [x] EXP-01 Share envelope JSON + original image via system share sheet

### Verifier
- [x] VER-01/02 `verify.html`: single self-contained file, works offline, loads JSON+image, shows hash match + signature valid
- [x] VER-08 Overall verdict: VERIFIED / VERIFIED WITH WARNINGS / FAILED, plain-language reasons

**Status (24 Sep):** all Phase 1 items built and checked in Node (`npm test`); the on-phone J1 run with the printed card is still to do. Also done: I18N-01 (strings externalised).

**Phase 1 exit criteria:** Journey J1 (login → kit → capture → calibrate → classify → save → signed+chained record → PDF/share) works end-to-end with manual kit select. The tamper demo (edit a byte → FAILED) works correctly.

---

## 3. Phase 2 — Integrity (P1) — never cut these

- [x] CAP-06 Record **every** capture (accepted or rejected) with hash, bytes, time, reasons, score; `retake_count = captures − 1` — done in Phase 1
- [x] HIS-04 VOID (replaces swipe-delete): reason required, creates a signed VOID record, original stays viewable/verifiable — fdtc.void/1; verifier shows VOIDED; TC-40
- [x] EVD-06 Integrity flags in every record: `rooted`, `mock_location`, `clock_skew` (>120s device vs GNSS), `location_unavailable` — clock skew vs GPS fix time; shown on result/record and in verify.html (VER-05)
- [x] EVD-07 Verify signed Reference DB at start-up; store version+SHA-256 in every record; tampered DB blocks testing — start-up check; refdb tests incl. DEMO-02
- [x] SYN-01 Key registry: register device key (GENESIS) with mock registry, queued if offline; verifier checks signer against it — Settings → server URL; auto-registers, retried from Home
- [x] EVD-08 Abandoned-test recovery → Inconclusive `ABANDONED` record if officer ends with ≥1 capture — draft persisted on every change; resume or end as ABANDONED
- [x] EVD-09 Device-log self-audit: re-verify whole local chain, highlight first failing `seq` — Settings → Audit ledger, per-record, first failure highlighted; Rebuild index
- **Status (24 Sep):** built; `npm run check:tamper` 22/22 (TC-33–38, TC-40, VER-03/05, EVD-06). TC-39 needs the PDF QR (Phase 3).
- **Exit criteria:** Tamper test suite (TC-33 to TC-39) green — flipped bytes, deleted records, unknown signers all correctly FAIL.

---

## 4. Phase 3 — Workflow (P1)

- [x] KIT-03/04/05 Kit QR scan (fills type/batch/mfg/expiry, locks kit type), status VALID/EXPIRED/NOT_YET_VALID/UNRECOGNISED, blocks anything but VALID — QR decoded from a photo (jsQR, no rebuild); `npm run kits` prints demo labels
- [x] TMR-01–07 Reaction timer from kit protocol: capture locked until `required_s`, vibration + "CAPTURE WINDOW OPEN", capture after `max_s` forces Inconclusive, timer survives backgrounding — demo timing setting (DEMO_PROTOCOL recorded)
- [x] CAP-04/05 Glare hard gate on reaction area (with pale/clear-sample exemption) + capture quality score (0–100, GOOD/FAIR/POOR, top 3 reasons) — glare gate at ROI; '92 / 100 — Good' / 'Poor — Retake: …'
- [x] RES-07 Structured Inconclusive reasons (full list, §8.2) + one recommended action (Retake / Repeat / Preserve for lab, most-severe wins) — done in Phase 1
- [x] HIS-03 History filters: date range, officer, outcome, kit type, case number (≤300ms @ 5,000 records) — < 300 ms on 5,000 records (measured on the real schema)
- [x] EXP-02/03 PDF report (SIMULATED watermark, hash, QR) + compact QR payload (`FDTC1|record_id|record_hash|key_id|signature`) — expo-print PDF; QR verifies in verify.html (VER-06, TC-39)
- [x] EXP-04 Export full device ledger for chain verification — Settings → Export device ledger
- [ ] Run the validation study (tools/validation-study) — tooling + app study mode done; synthetic dry run passes M1–M4; **phone run pending**. Dry run found & fixed a per-pixel spread false positive in dim light.
  - Original item: Run the validation study (tools/validation-study): accuracy, lighting invariance, Cohen's κ vs human panel → feeds success metrics M1–M4
- **Exit criteria:** M1–M4 measured and ready to show on a slide.

---

## 5. Phase 4 — Polish (P2) — cut first if time is short

- [ ] SYN-02–06 Offline sync queue (PENDING/SYNCING/SYNCED/FAILED), backoff, chain-conflict alert
- [ ] REV-01–03 Supervisor review (read-only, REVIEWED/REQUIRES_RETEST/REQUIRES_LAB_CONFIRMATION as a signed REVIEW record)
- [ ] RET-01–04 Retest comparison (linked `retest_of`, side-by-side view, `REPEAT_ALSO_INCONCLUSIVE` handling)
- [ ] EXP-05/06 Evidence ZIP + electronic-evidence certificate template (BSA s.63, marked DRAFT — REQUIRES LEGAL REVIEW)
- [ ] CUS-01 Custody events (sealed/handed over/received)
- [ ] CAL-07 / TMR-08 Card v2 (12-patch, reagent-hue) / baseline photo at timer start
- [ ] AUTH-06 Biometric unlock
- [ ] I18N-02 Hindi UI

---

## 6. Final sprint day — Sunday 27 Sep (per original plan)

- [ ] Run through Appendix A test cases (`prd.md` TC-01…TC-54), especially the tamper suite (TC-33–39) and demo-path cases (TC-04–08, TC-13–30)
- [ ] Record backup demo video (in case live demo/lighting fails)
- [ ] Prepare printable demo materials: reference card, swatch cards, valid + expired kit QR codes (all labelled "SIMULATED — NOT A DRUG TEST")
- [ ] 3 full dry-run rehearsals of the ~8-minute demo script (`prd.md` §13) — target **zero crashes** (M8) and **≤90s median officer-attended time** (M7)
- [ ] Finalize pitch deck: include validation-study slide (accuracy, lighting invariance, κ) and an honest "presumptive only / limits" closing slide

---

## 7. Open questions to resolve early (owner: team, from PRD §15)

- [ ] Q1 — Confirm hackathon length / team size (plan defaults to 4 people; scale phases if different)
- [ ] Q3 — Will the venue have network for the sync demo? If not, bring a phone hotspot
- [ ] Q6 — Decide who holds the Reference DB / registry signing keys for the demo (one laptop, never committed to repo)
- [ ] Q8 — Confirm officers see both outcome+confidence and raw ΔE (in a details section)

---

## 8. Non-goals (don't build these — explicitly out of scope)

- Identifying specific substances or showing drug names
- Replacing lab confirmatory testing
- A real reagent colour library (NIK/DABIT) — simulated kit profiles only
- Production PKI, HSMs, RFC 3161 timestamping, real backend (see Future scope, `prd.md` §6.4)
- Legal certification of the record format (templates are for legal review only)

---

## 9. Top risks to watch (from `prd.md` §14)

- Colour readings vary across phones/lighting → mitigate with affine correction + CIEDE2000; run validation study **early in Phase 3**, not at the end
- Native build problems (vision-camera, Skia) → Phase 0 spike on the actual demo phone, pin versions
- Crypto format mismatch between app and verifier → one shared `evidence-core`, cross-implementation test vectors in CI from day one
- Scope creep → P0 freeze, cut P2 first
