import {
  CORNER_ORDER,
  inconclusiveWithoutMeasurement,
  recommendedAction,
  type Classification,
  type InconclusiveReason,
} from '@fdtc/color-core';
import { roundTo, type TestRecord } from '@fdtc/evidence-core';
import type { KitProfile } from '@fdtc/refdb';

import type { Operator } from './auth';
import type { CaptureContext } from './context';
import { currentCapture, type Draft } from '../workflow/draft';

/** Evidence builder (ARCHITECTURE §7.3, §7.4): draft → rounded fdtc.test/1
 * record. Pure (no React Native), so it is exercised in Node against the
 * schema with the real measurement pipeline. */

const r = roundTo;
const r2 = (v: number) => r(v, 2);
const rXY = (v: number) => r(v, 1);

export function finalClassification(d: Draft): Classification {
  if (d.endedEarly && (!d.sample || d.endedEarly.kind !== 'HARD_GATE')) {
    return inconclusiveWithoutMeasurement(d.endedEarly.reasons);
  }
  const c = d.sample!.classification;
  if (!d.endedEarly) return c;
  // Ended on a hard gate after measuring (glare): keep the measurement, force Inconclusive.
  const reasons = [...new Set<InconclusiveReason>([...d.endedEarly.reasons, ...c.inconclusive_reasons])];
  return { ...c, outcome: 'INCONCLUSIVE', inconclusive_reasons: reasons, recommended_action: recommendedAction(reasons) };
}

export interface BuildInputs {
  draft: Draft;
  operator: Operator;
  ctx: CaptureContext;
  identity: { deviceId: string; keyId: string };
  refdb: { version: string; sha256: string };
  profile: KitProfile;
  cardVersion: string;
  /** Working-copy geometry of the accepted capture, if there is one. */
  wc: { width: number; height: number; scale: number; origWidth: number; origHeight: number } | null;
  app: { version: string; platform: string };
  createdAt: string;
}

export function buildTestRecord(inp: BuildInputs, seq: number, prevHash: string | null): TestRecord {
  const { draft: d, operator, ctx, identity, profile, wc } = inp;
  const cap = currentCapture(d);
  const s = wc?.scale ?? 1;
  const toOrig = (v: number) => rXY(v * s);
  const cls = finalClassification(d);
  const card = d.card;
  const sample = d.sample;
  return {
    schema: 'fdtc.test/1',
    record_type: 'TEST',
    record_id: d.recordId,
    device_id: identity.deviceId,
    key_id: identity.keyId,
    seq,
    prev_hash: prevHash!,
    created_at: inp.createdAt,
    simulated: true,
    source: 'CAMERA',
    operator: { badge_id: operator.badge_id, role: operator.role, auth_method: 'PIN' },
    case: { case_id: d.caseId, witness_badge_id: d.witness },
    kit: {
      kit_type: d.kitType,
      display_name: profile.display_name,
      entry: 'MANUAL',
      kit_id: null,
      batch: null,
      mfg_date: null,
      expiry_date: null,
      status: 'NOT_CHECKED',
    },
    timing: {
      timer: 'NONE',
      timer_start: null,
      capture_time: cap?.taken_at ?? d.captures.at(-1)?.taken_at ?? null,
      elapsed_s: null,
      required_s: profile.protocol.required_s,
      max_s: profile.protocol.max_s,
      in_window: null,
    },
    captures: d.captures.map((c) => ({
      n: c.n,
      sha256: c.sha256,
      bytes: c.bytes,
      taken_at: c.taken_at,
      accepted: c.accepted,
      reject_reasons: c.reject_reasons,
      quality_score: c === cap && sample ? sample.quality.score : null,
      laplacian_variance: c.laplacian_variance == null ? null : r(c.laplacian_variance, 1),
    })),
    evidence_image:
      cap && wc ? { n: cap.n, sha256: cap.sha256, mime: 'image/jpeg', bytes: cap.bytes, width: wc.origWidth, height: wc.origHeight } : null,
    working: wc ? { width: wc.width, height: wc.height, scale: r(wc.scale, 4) } : null,
    calibration:
      card && d.corners
        ? {
            card_version: inp.cardVersion,
            model: 'affine3x4',
            locate: 'corner-taps-homography/1',
            corners: Object.fromEntries(
              CORNER_ORDER.map((c) => [c, [toOrig(d.corners![c][0]), toOrig(d.corners![c][1])]])
            ) as NonNullable<TestRecord['calibration']>['corners'],
            corners_snapped: d.cornersSnapped,
            patches: Object.fromEntries(
              Object.entries(card.sampling.samples).map(([id, p]) => [
                id,
                {
                  xy: [toOrig(p!.xy[0]), toOrig(p!.xy[1])] as [number, number],
                  rgb: p!.rgb.map((v) => r(v, 1)) as [number, number, number],
                  mad: r2(p!.mad),
                  window: card.sampling.patches.find((q) => q.id === id)?.window ?? 0,
                },
              ])
            ),
            matrix: card.calibration.matrix.map((v) => r(v, 5)),
            residual_de00_mean: Number.isFinite(card.calibration.residual_de00_mean) ? r2(card.calibration.residual_de00_mean) : null,
            residual_de00_max: Number.isFinite(card.calibration.residual_de00_max) ? r2(card.calibration.residual_de00_max) : null,
            card_status: card.calibration.card_status,
            failed_checks: card.calibration.failed_checks,
          }
        : null,
    measurement:
      sample && d.roi
        ? {
            roi: { x: toOrig(d.roi.x), y: toOrig(d.roi.y), r: toOrig(d.roi.r) },
            lab: sample.roi.lab.map(r2) as [number, number, number],
            spread_de00_p90: r2(sample.roi.spread_de00_p90),
            area_px: sample.roi.area_px,
            glare_fraction: r(sample.glare.glare_fraction, 4),
            pale_exempt: sample.glare.pale_exempt,
          }
        : null,
    quality: sample
      ? {
          score: sample.quality.score,
          band: sample.quality.band,
          components: Object.fromEntries(Object.entries(sample.quality.components).map(([k, v]) => [k, r2(v)])),
          reasons: sample.quality.reasons,
          hard_gates: sample.quality.hard_gates,
        }
      : null,
    classification: {
      algorithm: cls.algorithm,
      outcome: cls.outcome,
      class_id: cls.class_id,
      class_label: cls.class_label,
      d1_de00: cls.d1_de00 == null ? null : r2(cls.d1_de00),
      d2_de00: cls.d2_de00 == null ? null : r2(cls.d2_de00),
      confidence: r(cls.confidence, 3),
      uncertainty_de00: r2(cls.uncertainty_de00),
      inconclusive_reasons: cls.inconclusive_reasons,
      recommended_action: cls.recommended_action,
    },
    location: ctx.location,
    clock: ctx.clock,
    integrity: ctx.integrity,
    reference_db: { version: inp.refdb.version, sha256: inp.refdb.sha256 },
    retest_of: null,
    retake_count: Math.max(0, d.captures.length - 1),
    ended_early: d.endedEarly?.kind ?? null,
    app: inp.app,
  };
}
