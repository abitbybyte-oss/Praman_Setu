/** Node check of the app's measurement + record pipeline (no phone needed):
 * synthetic card photo → corner snap → calibrate → measure → fdtc.test/1 →
 * schema → sign → verifyBundle. Run: npx tsx scripts/pipeline-check.ts */
import {
  applyHomography,
  CORNER_ORDER,
  homographyFrom4,
  labToLinear,
  linearToSrgb,
  PATCH_ORDER,
  type CornerId,
  type Lab,
  type Point,
  type RgbaImage,
} from '@fdtc/color-core';
import {
  buildGenesisRecord,
  buildLedgerExport,
  generateKeyPair,
  parseTestRecord,
  publicKeyFromPrivateKey,
  sealRecord,
  verifyBundle,
  type Envelope,
} from '@fdtc/evidence-core';

import { blurCheck, calibrateCard, defaultRoiRadius, measureSample, snapCorner } from '../src/services/measure';
import { buildTestRecord } from '../src/services/recordBuilder';
import { reportHtml } from '../src/services/reportHtml';
import { en } from '../src/i18n/en';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cardReference, DEFAULT_CARD, kit, loadRefdb } from '../src/services/refdb';
import { checkKitQr, formatKitQr } from '../src/services/kitqr';
import type { Draft } from '../src/workflow/draft';
import { startTimer } from '../src/workflow/timer';

const W = 1200;
const H = 1600;
const ref = cardReference(DEFAULT_CARD)!;
const L = ref.layout!;
const CARD_ON_IMG: Point[] = [
  [180, 260],
  [1030, 300],
  [1000, 800],
  [200, 770],
]; // tilted card in a portrait frame
const WARM = [0.95, 0.05, 0, 0.004, 0.02, 0.78, 0.02, 0.003, 0, 0.04, 0.55, 0.002];

function render(sample: Lab): { img: RgbaImage; markers: Record<CornerId, Point>; roi: Point } {
  const cardMm: Point[] = [
    [0, 0],
    [L.width_mm, 0],
    [L.width_mm, L.height_mm],
    [0, L.height_mm],
  ];
  const toCard = homographyFrom4(CARD_ON_IMG, cardMm);
  const toImg = homographyFrom4(cardMm, CARD_ON_IMG);
  const patch = new Map(ref.patches.map((p) => [p.id, labToLinear(p.lab)]));
  const paper = labToLinear([80, 0, 2]);
  const table = labToLinear([38, 3, 9]);
  const ink = labToLinear([12, 0, 0]);
  const dotCentre = labToLinear([95, 0, 0]);
  const reaction = labToLinear(sample);
  const roi: Point = [600, 1200];
  let seed = 9;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [u, v] = applyHomography(toCard, [x, y]);
      let lin = table;
      if (u >= 0 && v >= 0 && u <= L.width_mm && v <= L.height_mm) {
        lin = paper;
        for (const id of PATCH_ORDER) {
          const p = L.patches_mm[id];
          if (u >= p.x && u < p.x + p.size && v >= p.y && v < p.y + p.size) lin = patch.get(id)!;
        }
        for (const c of CORNER_ORDER) {
          const [mx, my] = L.markers_mm[c];
          const d = Math.hypot(u - mx, v - my);
          if (d <= L.marker_diameter_mm / 2) lin = d <= 0.7 ? dotCentre : ink;
        }
      }
      if (Math.hypot(x - roi[0], y - roi[1]) < 120) lin = reaction;
      const i = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const val = WARM[ch * 4] * lin[0] + WARM[ch * 4 + 1] * lin[1] + WARM[ch * 4 + 2] * lin[2] + WARM[ch * 4 + 3];
        data[i + ch] = Math.round(linearToSrgb(Math.max(0, val)) + (rnd() + rnd() + rnd() - 1.5) * 5);
      }
      data[i + 3] = 255;
    }
  const markers = Object.fromEntries(CORNER_ORDER.map((c) => [c, applyHomography(toImg, L.markers_mm[c])])) as Record<CornerId, Point>;
  return { img: { width: W, height: H, data }, markers, roi };
}

const H64 = (c: string) => c.repeat(64);
const refdb = loadRefdb();
const priv = generateKeyPair().privateKey;
const pub = publicKeyFromPrivateKey(priv);
const genesisRecord = buildGenesisRecord({
  publicKey: pub,
  recordId: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-09-24T10:00:00.000Z',
  appVersion: '0.1.0',
  platform: 'node',
});
const identity = { deviceId: genesisRecord.device_id, keyId: genesisRecord.key_id };
const chain: Envelope[] = [sealRecord(genesisRecord as never, priv, identity.keyId) as Envelope];
let ok = true;

function draftFor(kitType: string): Draft {
  return {
    recordId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    operator: { badge_id: '1001', name: 'Demo Officer', role: 'OFFICER' },
    kitType,
    kitScan: null,
    timer: null,
    caseId: 'FIR-DEMO-1',
    witness: null,
    captures: [],
    corners: null,
    cornersSnapped: [],
    card: null,
    roi: null,
    sample: null,
    endedEarly: null,
  };
}

function save(label: string, d: Draft, expectOutcome: string) {
  const prev = chain[chain.length - 1];
  const createdAt = new Date().toISOString();
  const deviceTime = createdAt;
  const build = (draft: Draft) => buildTestRecord(
    {
      draft,
      operator: { badge_id: '1001', name: 'Demo Officer', role: 'OFFICER' },
      ctx: {
        location: null,
        clock: { device_time: deviceTime, gnss_time: null, skew_s: null, monotonic_ms: 1234 },
        integrity: { rooted: false, mock_location: null, clock_skew: null, location_unavailable: true },
      },
      identity,
      refdb: { version: refdb.version, sha256: refdb.sha256 },
      profile: kit(draft.kitType),
      cardVersion: DEFAULT_CARD,
      wc: draft.captures.some((c) => c.accepted) ? { width: W, height: H, scale: 2.04, origWidth: 2448, origHeight: 3264 } : null,
      app: { version: '0.1.0', platform: 'node' },
      createdAt,
    },
    chain.length,
    prev.record_hash
  );
  const rec = build(d);
  // EVD-08: a draft recovered from its JSON copy must yield the identical record.
  const recovered = build(JSON.parse(JSON.stringify(d)) as Draft);
  if (JSON.stringify(recovered) !== JSON.stringify(rec)) {
    ok = false;
    const a = rec as unknown as Record<string, unknown>;
    const b = recovered as unknown as Record<string, unknown>;
    const diff = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    console.log(`✗ ${label}: draft recovered from JSON builds a different record in: ${diff.join(', ')}`);
    for (const k of diff) console.log(`    before ${JSON.stringify(a[k]).slice(0, 300)}
    after  ${JSON.stringify(b[k]).slice(0, 300)}`);
    return;
  }
  try {
    parseTestRecord(rec);
  } catch (e) {
    ok = false;
    console.log(`✗ ${label}: SCHEMA\n${(e as Error).message}`);
    return;
  }
  chain.push(sealRecord(rec as never, priv, identity.keyId) as Envelope);
  const c = rec.classification;
  const pass = c.outcome === expectOutcome;
  ok &&= pass;
  console.log(
    `${pass ? '✓' : '✗'} ${label}: ${c.outcome}${c.class_id ? ` (${c.class_id}, conf ${c.confidence}, d1 ${c.d1_de00})` : ''}` +
      `${c.inconclusive_reasons.length ? ` reasons=${c.inconclusive_reasons.join(',')} action=${c.recommended_action}` : ''}` +
      `${rec.quality ? ` quality=${rec.quality.score} ${rec.quality.band}` : ''}` +
      `${rec.calibration ? ` card=${rec.calibration.card_status} resid=${rec.calibration.residual_de00_mean}` : ''}`
  );
}

function fullRun(label: string, kitType: string, sample: Lab, expect: string, tapError: Point = [0, 0], timed?: { elapsed_s: number }) {
  const t0 = Date.now();
  const { img, markers, roi } = render(sample);
  const tRender = Date.now();
  const d = draftFor(kitType);
  if (timed) {
    // Scanned VALID kit + reaction timer, captured `elapsed_s` after START TIMER.
    d.kitScan = checkKitQr(
      formatKitQr({ kit_id: 'SIMKIT-000871', kit_type: kitType, manufacturer: 'Demo Labs', batch: 'B2026-07', mfg_date: '2026-01-10', expiry_date: '2099-01-10' }),
      refdb.db
    );
    d.timer = startTimer(kit(kitType).protocol, false, new Date(Date.now() - timed.elapsed_s * 1000));
  }
  const blur = blurCheck(img);
  d.captures.push({
    n: 1,
    uri: 'x',
    sha256: H64('a'),
    bytes: 2500000,
    taken_at: new Date().toISOString(),
    accepted: true,
    reject_reasons: [],
    laplacian_variance: blur.laplacian_variance,
    elapsed_s: timed ? timed.elapsed_s : null,
  });
  const snapped = CORNER_ORDER.map((c) => snapCorner(img, [markers[c][0] + tapError[0], markers[c][1] + tapError[1]]));
  d.corners = Object.fromEntries(CORNER_ORDER.map((c, i) => [c, snapped[i].point])) as Record<CornerId, Point>;
  d.cornersSnapped = snapped.map((s) => s.snapped);
  d.card = calibrateCard(img, d.corners);
  if (d.card.calibration.card_status !== 'VALID') {
    console.log(`  card INVALID: ${d.card.calibration.failed_checks.join(', ')} ${d.card.sampling.corners.problems.join(',')}`);
    d.endedEarly = { kind: 'CARD_INVALID', reasons: ['CARD_CALIBRATION_FAILED'] };
  } else {
    d.roi = { x: roi[0], y: roi[1], r: defaultRoiRadius(img) };
    d.sample = measureSample(img, d.roi, d.card, kitType);
  }
  const ms = Date.now() - tRender;
  save(`${label} [pipeline ${ms} ms, blur ${blur.laplacian_variance.toFixed(0)}, snapped ${d.cornersSnapped.filter(Boolean).length}/4]`, d, expect);
  void t0;
}

fullRun('SIM-A positive colour, taps 28 px off', 'SIM-A', [47, 41, -23], 'PRELIMINARY_POSITIVE', [22, -18]);
fullRun('SIM-A clear sample, taps 25 px off', 'SIM-A', [87, -1, 5], 'PRELIMINARY_NEGATIVE', [-15, 20]);
fullRun('SIM-A out-of-range colour', 'SIM-A', [50, -40, 40], 'INCONCLUSIVE');
fullRun('scanned kit + timer, captured at 150 s (in window)', 'SIM-A', [47, 41, -23], 'PRELIMINARY_POSITIVE', [0, 0], { elapsed_s: 150 });
fullRun('scanned kit + timer, captured at 420 s (late)', 'SIM-A', [47, 41, -23], 'INCONCLUSIVE', [0, 0], { elapsed_s: 420 });

{
  // Corners tapped in the wrong order → card invalid → officer ends the test.
  const { img, markers } = render([47, 41, -23]);
  const d = draftFor('SIM-B');
  d.captures.push({ n: 1, uri: 'x', sha256: H64('b'), bytes: 2400000, taken_at: new Date().toISOString(), accepted: true, reject_reasons: [], laplacian_variance: 300, elapsed_s: null });
  const taps = { top_left: markers.top_left, top_right: markers.bottom_left, bottom_right: markers.bottom_right, bottom_left: markers.top_right };
  d.corners = taps;
  d.cornersSnapped = [true, true, true, true];
  d.card = calibrateCard(img, taps);
  d.endedEarly = { kind: 'CARD_INVALID', reasons: ['CARD_CALIBRATION_FAILED'] };
  save('corners in wrong order → End test', d, 'INCONCLUSIVE');
}
{
  // Blurry capture, officer ends instead of retaking: no accepted photo.
  const d = draftFor('SIM-C');
  d.captures.push({ n: 1, uri: 'x', sha256: H64('c'), bytes: 2300000, taken_at: new Date().toISOString(), accepted: false, reject_reasons: ['IMAGE_BLURRY'], laplacian_variance: 12.3, elapsed_s: null });
  d.endedEarly = { kind: 'HARD_GATE', reasons: ['IMAGE_BLURRY'] };
  save('blurry, ended on hard gate', d, 'INCONCLUSIVE');
}

// EXP-02: render the PDF template for the first saved TEST record (preview in a browser).
{
  const env = chain[1] as Envelope<import('@fdtc/evidence-core').TestRecord>;
  const out = join(__dirname, '../../../tools/demo/report/dist');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'sample-report.html'), reportHtml({ envelope: env, imageBase64: null, void: null, S: en, generatedAt: new Date().toISOString() }));
  console.log(`report preview: ${join(out, 'sample-report.html')}`);
}

const report = verifyBundle({ bundle: buildLedgerExport(chain, identity.deviceId) });
console.log(`verifyBundle on ${chain.length} records: ${report.verdict}`);
for (const c of report.checks) console.log(`  [${c.status}] ${c.label}`);
ok &&= report.verdict !== 'FAILED';
console.log(ok ? '\nPIPELINE OK' : '\nPIPELINE FAILED');
process.exit(ok ? 0 : 1);
