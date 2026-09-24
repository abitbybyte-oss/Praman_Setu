Product Requirements Document
Field Drug Test Companion · PRD v1.0 · 2026-09-22 · Status: Draft for team review

Source specification	
Project path document
Architecture	ARCHITECTURE.md
Deliverable	Working mobile prototype: image capture, automated classification, signed digital record, verifier
Presumptive only. FDTC produces a presumptive field-test result and a supporting digital record. It does not replace laboratory confirmatory testing. The prototype is demonstrated with simulated materials only: no drugs, no real reagent kits. Every demo screen, record and printout is labelled "SIMULATED — NOT A DRUG TEST".

1. Summary
Field officers read colorimetric drug-test kits by eye. Readings vary between officers and lighting conditions, and no verifiable record shows that a test happened at a given place and time. FDTC is a mobile app that works with existing kits and needs no new hardware. It photographs the kit next to a printed reference colour card, corrects the colours for lighting, classifies the result against a versioned reference, and seals the result into a signed, hash-chained record that anyone can verify independently.

2. Problem
Today	Consequence
Colour change judged by eye	Subjective. Two officers can read the same kit differently.
Lighting varies (sun, street light, torch)	The same colour looks different. There is no correction.
Result written by hand, if at all	No proof of when or where the test was done, or by whom.
No image kept	Nothing to re-examine later.
No tamper evidence	A result can be changed after the fact without trace.
Result: field tests cannot be relied on as documentary evidence	
3. Goals and non-goals
Goals
#	Goal	Measured by
G1	Make the reading objective and repeatable	Accuracy and lighting-invariance metrics (§11)
G2	Produce a record that shows any tampering	100% detection in the tamper test suite
G3	Let a third party verify a record without trusting the officer, the device or the app	verify.html works offline from public data only
G4	Be honest about uncertainty	Structured Inconclusive reasons with a recommended action
G5	Work in the field without network	100% of tests complete and save offline
G6	Be demonstrable end-to-end with simulated materials	Demo script (§13) runs clean in three rehearsals
Non-goals
Identifying specific substances, or displaying drug names on simulated results.
Replacing laboratory confirmatory testing.
Shipping a real reagent colour library (NIK, DABIT). The prototype uses simulated kit profiles only.
Production PKI, HSMs, RFC 3161 timestamping, or a production backend (see Future scope, §6.4).
Legal certification of the record format. Templates are provided for legal review only.
4. Users
Persona	Context	Needs from FDTC
Field officer	Roadside or on-scene, time pressure, poor or changing light, possibly wearing gloves, not technical	A clear go / no-go at each step, big controls, a result they can trust, no extra paperwork
Supervisor	Station or remote, reviews tests from several officers	Read-only view of everything captured, the ability to flag for retest or lab, without being able to alter the original
Verifier	Forensic lab, prosecutor, defence counsel, court	Confidence that the record, the image, the time and the place are genuine, checked independently
Hackathon judge	Eight minutes, sceptical	See it work, understand why it can be trusted, see its limits stated honestly
5. Key user journeys
J1 — Officer runs a test Login → Start New Test → scan kit QR (VALID) → enter case ID → start reaction timer → align camera while waiting → capture window opens → capture → quality check passes → tap 6 reference patches → CARD VALID → tap the reaction area → result with confidence, quality and metadata → Save → record signed and chained → PDF / share.

J2 — Capture problem Capture → "Image too blurry, retake" → recapture → pass. Both capture hashes are in the final record, and retake_count = 1.

J3 — Inconclusive and retest Result is Inconclusive (MULTIPLE_COLOURS) → recommended action "Repeat field test" → Save → Repeat Test → new kit scan → Test 2 → side-by-side comparison. Test 1 is never edited.

J4 — Offline No network → test completes and saves normally → Home shows PENDING → network returns → auto-sync → SYNCED.

J5 — Supervisor review Supervisor login → list of submitted tests → open one read-only → mark REQUIRES_LAB_CONFIRMATION with a note → a separate signed review record is created.

J6 — Independent verification Verifier receives the JSON + image (or the PDF) → opens verify.html → loads the files → sees hash match, signature valid, signer registered, chain intact, integrity flags → VERIFIED. If any byte was changed → FAILED, with the reason.

6. Scope and priorities
Priority	Meaning	Roadmap phase
P0	Must work for the demo. The core loop.	Phase 1
P1	Integrity and workflow features that make the story credible	Phases 2–3
P2	In scope, built last, may be a light mock	Phase 4
Future	Documented, not built	—
6.1 P0 — Core loop
Mock PIN login · manual kit select · case ID · guided capture overlay · write-once original + SHA-256 · blur gate · 6-patch tap calibration with affine colour correction · card validation · sample ROI · CIEDE2000 classification with confidence and basic Inconclusive rules · timestamp, GPS, operator metadata · JCS + record hash + ES256 signature + hash chain · history list + detail · JSON + image export · verify.html (hash, signature, image) · SIMULATED labelling.

6.2 P1 — Integrity and workflow
All-capture hashes · VOID records (replacing delete) · clock-skew and mock-GPS flags · root flag · key registry · signed Reference DB · abandoned-test recovery · device-log self-audit · kit QR + status rules · reaction timer · full quality score · glare detection · structured Inconclusive reasons + actions · history filters · PDF with QR · ledger export and chain verification · validation study.

6.3 P2 — Polish
Offline sync queue with statuses · supervisor review · retest comparison · evidence ZIP · evidence-certificate template · custody events · baseline photo at timer start · multi-frame averaging · card v2 with reagent-hue patches · biometric unlock · Hindi UI.

6.4 Future scope
Hardware non-exportable keys + attestation · SQLCipher encryption · agency PKI with revocation · RFC 3161 trusted timestamps · HSM · Merkle anchoring · API gateway + PostgreSQL + S3 · analytics dashboard · multi-agency sync · ArUco auto card detection · on-device CNN classifier · full NIK + DABIT library · per-device calibration profiles · lab result linkage · court portal · multi-officer co-signing · full RBAC.

6.5 Changes from the original specification
These decisions come from the design review and are reflected in the requirements below.

Original	Now	Why
Swipe-delete with "breaks chain" warning	Void: a signed VOID record, original kept	Evidence must never be deleted. The chain stays intact.
White-patch gain correction	Affine 3×4 colour-correction matrix from all 6 patches	Uses all the calibration data. Much better colour accuracy.
ΔE (CIE76)	CIEDE2000	Current standard, defensible under questioning
Confidence = closeness to nearest	Margin ratio between nearest and second-nearest class, plus an uncertainty rule	Ambiguous colours become Inconclusive automatically
Only the kept image hashed	Every capture hashed and listed in the record	Prevents silent cherry-picking
Device time only	Device + GNSS + monotonic time, skew flag, server receipt time	The device clock can be changed
Public key inside the JSON	Agency key registry checked by the verifier	Otherwise anyone can sign a forgery with their own key
OpenCV for all image maths	TypeScript color-core on a downscaled working copy. OpenCV deferred to ArUco.	Testable, lower native-build risk
Exposure/WB lock required	Best-effort only. Correctness comes from the in-frame card.	Lock support varies by device
Capture button turns green "on alignment"	P0: overlay is a guide and the button enables when the window opens. Auto-alignment is Future (ArUco).	Alignment detection needs card detection
7. Functional requirements
Requirement IDs are stable. Reference them in tickets, commits and test cases.

7.1 Authentication and session — AUTH (Screen 1)
ID	Pri	Requirement	Acceptance criteria
AUTH-01	P0	Log in with badge ID + PIN against a local mock operator directory	Valid credentials open the role's home. Wrong PIN shows "Badge ID or PIN is incorrect". PINs stored as salted scrypt hashes, never plain text.
AUTH-02	P0	Route by role: Officer → Home, Supervisor → Review list	Role comes from the operator directory, not a toggle, in normal builds
AUTH-03	P1	Lock out after 5 failed attempts for 60 s	Countdown shown. Attempt logged to audit log.
AUTH-04	P1	Re-authenticate after 10 min of inactivity	An in-progress test draft is preserved and resumes after re-auth
AUTH-05	P1	Run root/jailbreak check at login	Result stored in the session and copied into every record's integrity.rooted. Not blocking in the prototype.
AUTH-06	P2	Biometric unlock after a first PIN login	Falls back to PIN. Records auth_method: BIOMETRIC.
7.2 Home — HOME (Screen 2)
ID	Pri	Requirement	Acceptance criteria
HOME-01	P0	Show officer name and badge, Start New Test, View History	
HOME-02	P0	Persistent "SIMULATED — NOT A DRUG TEST" banner in demo builds	Visible on every screen, not dismissible
HOME-03	P1	Integrity banner when the device-log self-audit fails or a sync chain conflict occurs	Red banner with the failing seq. Tapping it opens details.
HOME-04	P1	Offer to resume an unfinished test	"Resume test" or "End test" (ends as Inconclusive, ABANDONED)
HOME-05	P2	Sync summary: SYNCED / PENDING / FAILED counts	Tap opens History filtered by that status
7.3 Kit selection and QR — KIT (Screen 3)
ID	Pri	Requirement	Acceptance criteria
KIT-01	P0	Choose kit type from a dropdown (Test A–D, backed by simulated profiles SIM-A…SIM-D)	Only kit types present in the Reference DB are listed
KIT-02	P0	Optional case ID / FIR number and optional witness badge ID	Stored in case. Pre-filled on a repeat test.
KIT-03	P1	Scan Kit QR fills kit ID, type, manufacturer, batch/lot, manufacture date, expiry	Kit type auto-selects and locks after a scan. The SHA-256 of the raw QR payload is stored.
KIT-04	P1	Show kit summary: type, batch, expiry, status	Status computed per §8.3
KIT-05	P1	Block anything other than VALID	"Kit not valid — do not use" and Continue disabled. The rejection is written to the audit log, not the ledger.
7.4 Reaction timer — TMR (Screen 3A)
ID	Pri	Requirement	Acceptance criteria
TMR-01	P1	Show the kit protocol checklist from the Reference DB	
TMR-02	P1	START TIMER records timer_start. The interval comes from the kit protocol and cannot be edited.	No UI control changes required_s
TMR-03	P1	The camera may open for alignment during the countdown, but capture stays locked	Capture button disabled with the remaining time shown
TMR-04	P1	At required_s: vibration + "CAPTURE WINDOW OPEN" + capture enabled	
TMR-05	P1	Capture after max_s is allowed, but the result is forced Inconclusive	Reason OUTSIDE_REACTION_WINDOW
TMR-06	P1	The timer survives the app being backgrounded	Elapsed time recomputed from stored timestamps on return
TMR-07	P1	Store timer_start, capture_time, elapsed_s, required_s, max_s, in_window	
TMR-08	P2	Baseline photo at timer start (before reaction)	Hashed and listed in captures[] with kind: BASELINE
7.5 Guided capture and quality — CAP (Screen 4)
ID	Pri	Requirement	Acceptance criteria
CAP-01	P0	Live preview with two guide rectangles: reference card and test kit	
CAP-02	P0	Save the original JPEG write-once and compute SHA-256 over the exact file bytes before any processing	The exported image's sha256sum equals the stored hash
CAP-03	P0	Blur hard gate (Laplacian variance)	Below the hard threshold: "Image too blurry, retake"
CAP-04	P1	Glare hard gate on the reaction area	"Retake required — strong reflection detected". Pale or clear samples are not treated as glare.
CAP-05	P1	Show the capture quality score: 0–100, GOOD / FAIR / POOR, top 3 reasons	For example "92 / 100 — Good" or "Poor — Retake: blur, glare"
CAP-06	P1	Record every capture, accepted or rejected: n, SHA-256, bytes, time, reasons, score	All captures appear in captures[]. retake_count = captures − 1.
CAP-07	P1	Request exposure / white-balance lock where the device supports it	Best-effort. The result never depends on it.
CAP-08	P2	Burst of 3–5 frames averaged into the working copy	Every frame's original is hashed
7.6 Reference patches and card validation — CAL (Screen 5)
ID	Pri	Requirement	Acceptance criteria
CAL-01	P0	Prompted tap sequence: WHITE → BLACK → RED → GREEN → BLUE → GRAY, with a dot on each tap	Undo last tap. Retake always available.
CAL-02	P0	Sample each patch as the median of a k×k window	A non-uniform window prompts "Tap nearer the centre of the patch"
CAL-03	P0	Fit an affine 3×4 colour-correction matrix and compute the residual CIEDE2000	Matrix, mean and max residual stored
CAL-04	P0	Run the card validation checks (ARCHITECTURE §6.2)	CARD VALID, or CARD INVALID — DO NOT CONTINUE with each failed check listed
CAL-05	P0	On CARD INVALID offer Retake or End Test	End Test saves an Inconclusive record, reason CARD_CALIBRATION_FAILED
CAL-06	P1	Read the card version from the card's QR code	P0 default: FDTC-CARD-1
CAL-07	P2	Card v2 with reagent-hue patches (12-patch fit) and per-print-batch Lab values in the card QR	
7.7 Sample region — ROI (Screen 6)
ID	Pri	Requirement	Acceptance criteria
ROI-01	P0	Show the colour-corrected image. "Tap centre of colour change." Adjustable circle radius (slider).	
ROI-02	P0	Compute the corrected median colour → Lab, the p90 spread and the area	Stored in measurement
ROI-03	P1	Live checks: "Reaction area too small", "Multiple colours detected", strong glare hard block	Updates as the circle moves or resizes
ROI-04	P0	Retake or End Test	End Test saves an Inconclusive record with the applicable reason
7.8 Result — RES (Screen 7)
ID	Pri	Requirement	Acceptance criteria
RES-01	P0	Outcome: Preliminary Positive / Preliminary Negative / Inconclusive, with colour-match confidence and ΔE00 to the nearest class	Wording per §8.1
RES-02	P0	In demo builds, show only simulated wording	For example "DEMO: Simulated Preliminary Positive — colour-match confidence 94%". Never a drug name.
RES-03	P0	Card status + calibration residual	
RES-04	P0	Metadata: timestamp, GPS with accuracy, operator ID, kit type, case ID, Reference DB version	
RES-05	P1	Capture quality section: score, band, top reasons	
RES-06	P1	Kit section (type, batch, expiry, status) and timing section (required, actual, in-window)	
RES-07	P1	When Inconclusive, list all applicable reasons and one recommended action	Mapping per §8.2
RES-08	P1	Show integrity flags when present: rooted, mock location, clock skew, location unavailable	Amber chips with text, not colour alone
RES-09	P0	Buttons: Save, Retake	Retake keeps all earlier capture hashes
RES-10	P2	Button: Repeat test	Opens a new linked test (§7.12)
7.9 Evidence record — EVD (Screen 8)
ID	Pri	Requirement	Acceptance criteria
EVD-01	P0	Assemble the record per schema fdtc.test/1, with rounding and schema validation	An invalid record cannot be saved. The error names the field.
EVD-02	P0	In one transaction: set seq and prev_hash, canonicalise (RFC 8785), compute record_hash, sign ES256, insert ledger + index + outbox	Killing the app mid-save leaves either a full record or none
EVD-03	P0	Create a GENESIS record with the device public key on first launch	seq = 0, self-signed
EVD-04	P0	Store the full field set: test_id, timestamp, GPS, operator_id, kit type / ID / batch / expiry, timer data, quality score + reasons, card validation + residual, result + confidence + ΔE, Inconclusive reasons, retake_count, retest_of, Reference DB version	Field list matches ARCHITECTURE §7.3
EVD-05	P0	Ledger is append-only	UPDATE or DELETE on the ledger aborts
EVD-06	P1	Integrity signals in every record: rooted, mock_location, clock_skew (> 120 s device vs GNSS), location_unavailable	
EVD-07	P1	Verify the signed Reference DB at start-up. Store its version and SHA-256 in every record.	A tampered Reference DB blocks testing
EVD-08	P1	Abandoned-test recovery	An unfinished test with ≥ 1 capture becomes an Inconclusive ABANDONED record if the officer ends it
EVD-09	P1	Verify my device log: re-verify the whole local chain	Per-record pass/fail. The first failing seq is highlighted.
7.10 History and search — HIS (Screen 9)
ID	Pri	Requirement	Acceptance criteria
HIS-01	P0	List newest first: short test ID, outcome, time, kit, sync badge	
HIS-02	P0	Read-only detail view (same layout as the result screen) plus record hash, signature status and chain position	
HIS-03	P1	Filters: date range, officer, outcome, kit type, case number	≤ 300 ms with 5,000 records
HIS-04	P1	Void (replaces swipe-delete): reason required, confirmation, creates a VOID record	The list shows VOIDED. The original stays viewable, exportable and verifiable. Only the original officer or a supervisor can void. A VOID cannot itself be voided.
HIS-05	P2	Review status shown on each record (from supervisor reviews)	
7.11 Retest — RET (Screen 9A)
ID	Pri	Requirement	Acceptance criteria
RET-01	P2	Repeat Test opens kit selection with case ID and kit type pre-filled	A new kit scan is required
RET-02	P2	Test 2 stores retest_of = {record_id, record_hash} of Test 1	Test 1's stored bytes are unchanged (hash identical before and after)
RET-03	P2	Side-by-side read-only comparison: result, ΔE, quality, card status, kit/batch, reaction time, timestamp	No merged or combined result is computed or displayed
RET-04	P2	If Test 1 and Test 2 are both Inconclusive, Test 2 gets REPEAT_ALSO_INCONCLUSIVE → Preserve for lab	
7.12 Export — EXP
ID	Pri	Requirement	Acceptance criteria
EXP-01	P0	Share the envelope JSON + original image through the system share sheet	Files verify in verify.html unchanged
EXP-02	P1	PDF report: SIMULATED watermark (demo), result, metadata, image rendition, record hash, signature, key ID, seq, QR code	States that the image hash refers to the original file, not the PDF rendition
EXP-03	P1	Compact QR payload: FDTC1|record_id|record_hash|key_id|signature	Decodes with any QR app. verify.html accepts it.
EXP-04	P1	Export the full device ledger for chain verification	
EXP-05	P2	Evidence ZIP: envelope, original image, public key, Reference DB hash, README with verification steps	
EXP-06	P2	Electronic-evidence certificate template (Bharatiya Sakshya Adhiniyam s.63 format, formerly s.65B), pre-filled	Marked "DRAFT TEMPLATE — REQUIRES LEGAL REVIEW"
7.13 Verification — VER (Screen 10)
ID	Pri	Requirement	Acceptance criteria
VER-01	P0	verify.html loads an envelope JSON + image and shows hash match and signature valid	
VER-02	P0	Single self-contained file. Works offline, makes no external requests unless a registry URL is given.	Works from file:// in current Chrome, Edge, Firefox and Safari
VER-03	P1	Check the signer against the key registry (URL or file)	Unknown or revoked key → FAILED. No registry loaded → WARN "signer not checked". Key registered after the record was created → WARN.
VER-04	P1	Chain check on a ledger export	A seq gap or broken link is reported with its position
VER-05	P1	Show integrity flags, card status, quality, timing window and void status	
VER-06	P1	Verify from a PDF QR string alone (hash + signature + key)	
VER-07	P1	Open verify.html in an in-app WebView from Screen 10	
VER-08	P0	Overall verdict: VERIFIED, VERIFIED WITH WARNINGS or FAILED, with plain-language reasons	
7.14 Sync — SYN
ID	Pri	Requirement	Acceptance criteria
SYN-01	P1	Register the device key (GENESIS) with the mock key registry. Queued if offline.	
SYN-02	P2	Every record is saved locally before any sync. Outbox statuses PENDING / SYNCING / SYNCED / FAILED.	
SYN-03	P2	Automatic sync when the network returns. Exponential backoff. Manual Retry.	
SYN-04	P2	Chain conflict (409) is never retried automatically and raises an integrity alert	
SYN-05	P2	Images upload after their record. The server re-hashes and rejects a mismatch.	
SYN-06	P2	Sync never deletes local evidence	
7.15 Supervisor review — REV
ID	Pri	Requirement	Acceptance criteria
REV-01	P2	Supervisor list with the history filters; read-only detail	No edit controls on test data
REV-02	P2	Set review status REVIEWED / REQUIRES RETEST / REQUIRES LAB CONFIRMATION, with an optional note	Creates a signed REVIEW record referencing {record_id, record_hash}. The original's bytes are unchanged.
REV-03	P2	Show retake count ≥ 3 and integrity flags prominently in the review view	
7.16 Custody — CUS
ID	Pri	Requirement	Acceptance criteria
CUS-01	P2	Scan a seal / evidence-bag ID and log custody events: sealed, handed over, received	Each event is a signed CUSTODY record linked to the test
7.17 Demo and study support — DEMO
ID	Pri	Requirement	Acceptance criteria
DEMO-01	P0	Demo build: banner on every screen, watermark on PDFs, simulated: true in every record	Cannot be switched off in a demo build
DEMO-02	P0	Demo Reference DB contains only simulated profiles with labels such as "Simulated colour A"	No substance names anywhere in the demo DB
DEMO-03	P1	Short demo reaction interval (demo_required_s, for example 20 s)	The record states which interval was used
DEMO-04	P1	Fixture mode (dev builds only): load a bundled image instead of the camera	source: "FIXTURE" shown on the result, PDF and verifier
DEMO-05	P1	Study mode (dev builds only): tester selects the true swatch before capture; results export as CSV	Feeds tools/validation-study
DEMO-06	P1	Printable demo materials: reference card, swatch cards, valid and expired kit QR codes	Each printed with "SIMULATED — NOT A DRUG TEST"
7.18 Localisation — I18N
ID	Pri	Requirement	Acceptance criteria
I18N-01	P0	All UI strings externalised	No hard-coded user-facing strings
I18N-02	P2	Hindi translation	Language switch in settings
8. Business rules
8.1 Outcomes and wording
Outcome	Officer text	Demo text	Always shown with
PRELIMINARY_POSITIVE	Preliminary Positive	DEMO: Simulated Preliminary Positive	"Presumptive result only. Laboratory confirmation required."
PRELIMINARY_NEGATIVE	Preliminary Negative	DEMO: Simulated Preliminary Negative	"No colour match to a positive reference. This does not rule out the presence of a substance."
INCONCLUSIVE	Inconclusive	DEMO: Inconclusive	All applicable reasons + one recommended action
Confidence is always labelled "colour-match confidence". It is the margin ratio defined in ARCHITECTURE §6.4 and must never be presented as the probability that a drug is present.

8.2 Inconclusive reasons and recommended actions
Code	Officer text	Recommended action
IMAGE_BLURRY	Image too blurry	Retake photograph
POOR_LIGHTING	Poor lighting	Retake photograph
EXCESSIVE_GLARE	Excessive glare	Retake photograph
REACTION_AREA_TOO_SMALL	Reaction area too small	Retake photograph
CARD_CALIBRATION_FAILED	Card calibration failed	Retake photograph
MULTIPLE_COLOURS	Multiple colours detected	Repeat field test
MEASUREMENT_UNCERTAINTY_HIGH	Measurement uncertainty too high	Repeat field test
OUTSIDE_REACTION_WINDOW	Captured outside reaction window	Repeat field test
ABANDONED	Test ended before saving	Repeat field test
OUTSIDE_REFERENCE_RANGE	Reaction outside reference range	Preserve sample for laboratory confirmation
REPEAT_ALSO_INCONCLUSIVE	Repeat test also inconclusive	Preserve sample for laboratory confirmation
Action text on screen:

Retake photograph — "Retake photograph — correctable capture issue"
Repeat field test — "Repeat field test according to kit protocol"
Preserve for lab — "Preserve sample for laboratory confirmation"
When several reasons apply, all are listed and the most severe action is shown: Preserve for lab > Repeat test > Retake.

8.3 Kit status
Status	Rule	Continue?
VALID	QR well-formed, kit type in the Reference DB, manufacture date ≤ today ≤ expiry	Yes
EXPIRED	today > expiry	No
NOT_YET_VALID	manufacture date > today (suspicious: possibly a clock problem)	No
UNRECOGNISED	Malformed QR, unknown kit type or unknown manufacturer	No
"Today" is device time. If the clock-skew flag is set, it is shown next to the kit status.

8.4 Capture quality
Score, weights and hard gates are defined in ARCHITECTURE §6.5. Bands: GOOD 80–100, FAIR 60–79, POOR < 60 (initial cut-offs, tuned by the validation study). A POOR capture may be saved, but it adds the dominant quality reason and makes the result Inconclusive.

8.5 Retakes
No hard limit on retakes. Every capture is hashed and kept.
retake_count ≥ 3 is highlighted on the result screen and in supervisor review.
8.6 Voiding
Reason required: Entered in error · Wrong case · Duplicate · Test procedure error · Other (free text, required).
Allowed for the original officer or a supervisor.
A voided record stays in the ledger, still verifies, and is shown as VOIDED everywhere it appears.
8.7 Thresholds
All numeric thresholds live in the signed Reference DB (ARCHITECTURE §12), never in code. Changing a threshold means issuing a new Reference DB version.

9. Non-functional requirements
ID	Category	Requirement
NFR-01	Performance	Capture → quality result ≤ 2 s on a mid-range Android phone (2022 or later, 6 GB RAM)
NFR-02	Performance	Save (hash + sign + insert) ≤ 1 s
NFR-03	Performance	History query ≤ 300 ms with 5,000 records
NFR-04	Performance	Cold start ≤ 3 s
NFR-05	Offline	Everything except sync, registry fetch and the remote supervisor list works with no network
NFR-06	Durability	No evidence loss if the app is killed at any point
NFR-07	Determinism	The golden pipeline gives identical outcomes on Android, iOS and Node
NFR-08	Security	The private key is only held in memory for signing, is never logged and is never exported. Logs contain no evidence data.
NFR-09	Privacy	No suspect personal-data fields. Case ID only. The frame should contain only the kit and card.
NFR-10	Accessibility	Touch targets ≥ 48 dp. Status always shown as text + icon, never colour alone. Supports system font scaling up to 130%.
NFR-11	Usability	Officer-attended time ≤ 90 s median per test, excluding the reaction wait. Operable with gloves (large controls, no small gestures).
NFR-12	Platform	Android 10+ primary, iOS 16+ secondary. Rear camera ≥ 12 MP.
NFR-13	Storage	About 3–5 MB per test. Warn below 500 MB free, block new tests below 200 MB.
NFR-14	Verifier	Runs from file:// in current Chrome, Edge, Firefox and Safari with no network
10. Data and privacy
Data	Why it is needed	Notes
Officer badge ID and name	Attribution	Staff data from the mock directory
Case ID / FIR number	Linking to the case	Optional. No suspect name, ID number or photo.
Location + accuracy	Proof of place	Stored in the record. Exports contain it, so share only through agency channels.
Kit and card images	The evidence	Framing guidance: kit and card only, no people
Device info	Integrity signals	Model, OS version, app version, root flag
Retention: the prototype keeps everything locally. Production follows agency policy. Voiding is not deleting.
Encryption at rest: the prototype relies on the OS sandbox and device encryption. SQLCipher is future scope.
India DPDP Act 2023: the design follows purpose limitation, data minimisation and reasonable security safeguards. Compliance needs legal review before any real deployment.
11. Success metrics
#	Metric	Target
M1	Classification accuracy on the validation set (≥ 6 simulated swatches × 4 lighting conditions × 2 phones × 5 captures = 240 captures), excluding Inconclusive	≥ 95%
M2	Inconclusive rate on GOOD-quality captures	≤ 10%
M3	Lighting invariance: median CIEDE2000 between calibrated readings of the same swatch across the 4 lighting conditions	≤ 3.0 (raw readings expected > 10)
M4	Agreement with ground truth, app vs a 5-person eye-reading panel	Report Cohen's κ for both. Target: app κ ≥ 0.9 and higher than the panel.
M5	Tamper detection: any byte changed in a record or image, any record deleted or reordered	100% detected
M6	Offline: tests saved with the network off, then synced after reconnect	100%, no loss
M7	Officer-attended time per test, excluding the reaction wait	≤ 90 s median in rehearsal
M8	Demo reliability	Zero crashes across 3 full rehearsals
Lighting conditions: daylight by a window, cool-white LED, warm incandescent or warm LED, dim / street-light simulation.

12. Milestones
Durations depend on the hackathon length (open question Q1). The effort split is a guide.

Phase	Effort	Content	Exit criteria
0 — Setup and spikes	10%	Monorepo, Expo dev build on the actual demo phone with vision-camera + Skia + SQLite. Sign in RN, verify in Node and in the browser.	A photo taken on the phone is hashed and signed, and the signature verifies in verify.html and in Node crypto.verify
1 — Core loop (P0)	35%	Capture, calibration, classification, record, chain, history, export, verify.html	J1 works end-to-end with manual kit select. Tamper demo fails correctly.
2 — Integrity (P1)	20%	All-capture hashes, VOID, clock/GPS/root flags, key registry, signed Reference DB, abandoned recovery, self-audit	Tamper test suite (TC-33 to TC-39) green
3 — Workflow (P1)	20%	Kit QR, timer, full quality score, glare, reasons + actions, filters, PDF + QR, validation study run	M1–M4 measured and on a slide
4 — Polish (P2) and demo	15%	Sync, supervisor review, retest comparison, remaining P2 as time allows. Three rehearsals.	Demo script runs clean three times (M8)
Rule: when time runs short, cut P2 items first, then P1 workflow items. Never cut the integrity items. They are the core of the proposal.

Suggested team split (4 people)
Role	Owns
Mobile + workflow	Screens, state machine, camera, capture, history, timer
Colour science	color-core, quality, card validation, classification, Reference DB values, validation study
Evidence + verifier	evidence-core, ledger, signing, key store, verify.html, tamper tests
Server + export + demo	Mock server, sync, PDF/QR/ZIP, printable demo materials, pitch deck
With fewer people, merge "Server + export + demo" into "Evidence + verifier" first.

13. Demo plan (about 8 minutes)
Time	Step	What the judges see
0:00	Problem	Two people read the same swatch differently. No record exists.
0:30	Login + kit	Valid kit QR → VALID. Expired kit QR → "Kit not valid — do not use".
1:30	Timer	Capture locked → CAPTURE WINDOW OPEN (20 s demo interval)
2:00	Capture	Deliberately blurry → "Poor — Retake". Retake → "92 / 100 — Good".
3:00	Card	Wrong patch tapped → CARD INVALID with the failed check. Redo → CARD VALID.
3:45	Result	"DEMO: Simulated Preliminary Positive — colour-match confidence 94%", with metadata
4:15	Save + PDF	Signed record, PDF with hash and QR
4:45	Verify	verify.html → VERIFIED. sha256sum of the image on the laptop matches the record.
5:30	Tamper	Edit "POSITIVE" → "NEGATIVE" in the JSON → FAILED. Flip one image byte → FAILED.
6:15	Integrity	The record lists both captures (no cherry-picking). Void a record → chain intact.
6:45	Evidence	Validation-study slide: accuracy, lighting invariance, κ vs human panel
7:30	Close	Presumptive only, lab confirmation still required. Future scope.
Backup: fixture mode, pre-recorded video, a desk lamp and a warm bulb, printed spare materials.

14. Risks
Risk	Likelihood	Impact	Mitigation
Colour readings vary across phones and lighting	High	High	Affine correction + CIEDE2000. Run the validation study at the start of Phase 3, not at the end.
Native build problems (vision-camera, Skia)	Medium	High	Phase 0 spike on the actual demo phone. Pin SDK and library versions.
Crypto format mismatch between app and verifier	Medium	High	One shared evidence-core. Cross-implementation test vectors in CI from day one.
Scope creep	High	High	P0 freeze. P2 cut first.
Demo-day lighting	Medium	Medium	Bring lamps, fixture mode, recorded video
Judges challenge legal standing	Medium	Medium	Presumptive disclaimer, threat-model slide, honest residual risks
Misreading as drug detection	Low	High	Wording rules, SIMULATED labelling everywhere, no substance names in demo data
JS pixel maths too slow	Low	Medium	1600 px working copy. Move hot loops to Skia shaders or OpenCV if needed.
15. Open questions
#	Question	Default if unanswered
Q1	How long is the hackathon, and how big is the team?	Plan for 4 people. Scale phases proportionally.
Q2	Is an Android-only demo acceptable?	Yes. iOS if time allows.
Q3	Will the venue have a network for the sync demo?	Bring a phone hotspot
Q4	Should missing location block a test, or only flag it?	Flag only
Q5	Which evidence-certificate format should the template follow?	Bharatiya Sakshya Adhiniyam s.63
Q6	Who holds the Reference DB and registry signing keys for the demo?	One team laptop, keys never committed to the repo
Q7	Is a spectrophotometer available to measure the printed card?	Average of captures under daylight-like LED, documented as an approximation
Q8	Should officers see raw ΔE values, or only outcome and confidence?	Show both. ΔE in a "details" section.
Appendix A — Test cases
ID	Area	Condition / steps	Expected	Pri
TC-01	AUTH	Officer logs in with a valid badge + PIN	Officer Home	P0
TC-02	AUTH	Wrong PIN 5 times	60 s lockout, logged	P1
TC-03	AUTH	Supervisor logs in	Review list	P0
TC-04	KIT	Scan valid simulated kit QR	VALID, type locked, Continue enabled	P1
TC-05	KIT	Scan expired kit QR	EXPIRED, "Kit not valid — do not use", Continue disabled	P1
TC-06	KIT	Scan QR with an unknown kit type	UNRECOGNISED, blocked	P1
TC-07	KIT	Scan random non-kit QR text	UNRECOGNISED, no crash	P1
TC-08	KIT	Kit QR with manufacture date in the future	NOT_YET_VALID, blocked	P1
TC-09	TMR	Try to capture before required_s	Capture disabled, remaining time shown	P1
TC-10	TMR	Wait until required_s	Vibration + CAPTURE WINDOW OPEN	P1
TC-11	TMR	Capture after max_s	Saved as Inconclusive, OUTSIDE_REACTION_WINDOW	P1
TC-12	TMR	Background the app for 60 s during the countdown	Elapsed time correct on return	P1
TC-13	CAP	Sharp, evenly lit capture	Score ≥ 80, GOOD	P1
TC-14	CAP	Motion-blurred capture	"Image too blurry, retake"	P0
TC-15	CAP	Lamp reflection on a glossy pouch over the ROI	"Retake required — strong reflection detected"	P1
TC-16	CAP	Clear / pale sample with no reflection	Not flagged as glare	P1
TC-17	CAP	Capture 3 times (2 rejected, 1 accepted)	captures[] has 3 entries, retake_count = 2	P1
TC-18	CAP	Export the image, run sha256sum / certutil -hashfile	Matches evidence_image.sha256	P0
TC-19	CAL	Correct taps on a good capture	CARD VALID, mean residual ≤ 3.0	P0
TC-20	CAL	Red and blue taps swapped	CARD INVALID, "expected hue" listed	P0
TC-21	CAL	Overexposed capture (white clipped)	CARD INVALID, "white patch clipped" listed	P0
TC-22	CAL	Tap on a patch edge	"Tap nearer the centre of the patch"	P0
TC-23	CAL	CARD INVALID, then End Test	Inconclusive record, CARD_CALIBRATION_FAILED	P0
TC-24	ROI	Radius below the minimum	"Reaction area too small"	P1
TC-25	ROI	Circle straddling two colours	"Multiple colours detected" → Inconclusive	P1
TC-26	RES	Simulated swatch A	"DEMO: Simulated Preliminary Positive", confidence shown	P0
TC-27	RES	Simulated clear swatch	"DEMO: Simulated Preliminary Negative"	P0
TC-28	RES	Swatch halfway between A and clear	MEASUREMENT_UNCERTAINTY_HIGH → Repeat field test	P0
TC-29	RES	Off-palette colour (for example bright green)	OUTSIDE_REFERENCE_RANGE → Preserve for lab	P0
TC-30	RES	Same swatch under cool LED and warm bulb	Same outcome, ΔE00 between calibrated readings ≤ 3.0	P1
TC-31	EVD	Save a test	seq = head + 1, prev_hash = previous record_hash, signature verifies in Node crypto.verify	P0
TC-32	EVD	Kill the app during Save	Either a full record or none. Draft recoverable.	P0
TC-33	EVD	Run UPDATE / DELETE on ledger in a debug build	Aborted by trigger	P0
TC-34	VER	Unmodified export	VERIFIED	P0
TC-35	VER	Change the outcome in the JSON	FAILED: record content altered	P0
TC-36	VER	Flip one byte of the image	FAILED: image altered	P0
TC-37	VER	Record re-signed with a key not in the registry	FAILED: unknown signer	P1
TC-38	VER	Ledger export with a middle record removed	FAILED at that seq (gap or broken link)	P1
TC-39	VER	Paste the PDF QR string only	Signature valid for that hash and key	P1
TC-40	HIS	Void a record with a reason	VOID record created. Original still verifies and shows VOIDED.	P1
TC-41	HIS	Filter by case ID + outcome with 5,000 records	Correct subset in ≤ 300 ms	P1
TC-42	RET	Repeat a test	Test 2 has retest_of = {id, hash} of Test 1. Test 1 bytes unchanged. Side-by-side view shown.	P2
TC-43	RET	Test 1 and Test 2 both Inconclusive	Test 2 adds REPEAT_ALSO_INCONCLUSIVE → Preserve for lab	P2
TC-44	SYN	Save in airplane mode, then reconnect	PENDING → SYNCED automatically	P2
TC-45	SYN	Server down during sync	FAILED, backoff, manual Retry works	P2
TC-46	SYN	Server head differs from device chain	CHAIN_CONFLICT, no auto-retry, Home banner	P2
TC-47	INT	Mock-location app active	mock_location flag on result and verifier	P1
TC-48	INT	Device clock set 2 hours back	clock_skew flag	P1
TC-49	INT	Rooted device or emulator	rooted flag	P1
TC-50	INT	Location permission denied	Test proceeds, location_unavailable flag	P1
TC-51	REF	Edit a threshold in the bundled Reference DB	Testing blocked: "Reference data failed verification"	P1
TC-52	REV	Supervisor marks REQUIRES LAB CONFIRMATION	Signed REVIEW record. Original bytes unchanged. Officer sees the status.	P2
TC-53	EXP	Generate the PDF	SIMULATED watermark, hash, QR. QR decodes to a valid payload.	P1
TC-54	EVD	Kill the app after 2 captures, relaunch, choose End test	Inconclusive ABANDONED record listing both capture hashes	P1
Appendix B — Glossary
Term	Meaning
Presumptive test	A quick screening test that suggests a substance may be present. It must be confirmed in a laboratory.
Colorimetric kit	A test that shows its result as a colour change
Reference colour card	A printed card with known colour patches, photographed next to the kit to correct for lighting
Colour-correction matrix (CCM)	A 3×4 transform, fitted from the card patches, that maps the camera's colours to the card's known colours
CIELAB (Lab)	A colour space designed so that distances roughly match perceived differences
CIEDE2000 (ΔE00)	The standard formula for the perceived difference between two Lab colours
ROI	Region of interest: the circle the officer places on the reaction area
JCS	JSON Canonicalization Scheme (RFC 8785): one exact byte form for a JSON object, so everyone hashes the same bytes
ES256	ECDSA signature on the P-256 curve with SHA-256
Ledger	The device's append-only list of signed records
Hash chain	Each record includes the previous record's hash, so removing or reordering records is detectable
Anchor	The server's copy of a device's latest chain position, recorded at sync
GENESIS / VOID / REVIEW / CUSTODY	Record types: device key registration, withdrawal of a record, supervisor review, chain-of-custody event
Outbox	Local queue of records waiting to sync
Reference DB	Signed, versioned data file with card values, kit protocols, colour classes and thresholds
FIR	First Information Report (India): the police case reference
BSA s.63	Bharatiya Sakshya Adhiniyam 2023, section 63: certificate for admitting electronic records (formerly Evidence Act s.65B)
