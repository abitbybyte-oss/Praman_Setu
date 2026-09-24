import { describe, expect, it } from 'vitest';

import { cohensKappa, analyse } from '../../../../../tools/validation-study/analyse';
import { fromCsv, toCsv, type StudyRow } from '../studyCsv';

const row = (i: number, truth: string, pred: string, lighting = 'DAYLIGHT', band = 'GOOD'): StudyRow => ({
  study_id: `S${i}`, captured_at: '2026-09-24T10:00:00.000Z', source: 'CAMERA', device: 'phone "A", v2', lighting,
  kit_type: 'SIM-A', true_class: truth === 'PRELIMINARY_POSITIVE' ? 'SIM-A-POS' : 'SIM-A-NEG', true_outcome: truth,
  pred_outcome: pred, pred_class: '', confidence: 0.9, d1_de00: 1.2, d2_de00: 30, raw_L: 50, raw_a: 30, raw_b: -10,
  cal_L: 48, cal_a: 40, cal_b: -22, residual_de00_mean: 0.8, card_status: 'VALID', quality_score: 90, quality_band: band, reasons: '',
});

describe('validation study tooling', () => {
  it('CSV round-trips, including quotes and commas', () => {
    const rows = [row(1, 'PRELIMINARY_POSITIVE', 'PRELIMINARY_POSITIVE'), { ...row(2, 'PRELIMINARY_NEGATIVE', 'INCONCLUSIVE'), confidence: null }];
    expect(fromCsv(toCsv(rows))).toEqual(rows);
  });

  it("Cohen's kappa matches known values", () => {
    expect(cohensKappa(['a', 'b', 'a', 'b'], ['a', 'b', 'a', 'b'])).toBe(1);
    // Classic 2x2 example: po = 0.7, pe = 0.5 → κ = 0.4
    const a = ['y', 'y', 'y', 'y', 'y', 'n', 'n', 'n', 'n', 'n'];
    const b = ['y', 'y', 'y', 'y', 'n', 'n', 'n', 'n', 'y', 'y'];
    expect(cohensKappa(a, b)).toBeCloseTo(0.4, 10);
  });

  it('M1 excludes Inconclusive; M2 counts Inconclusive among GOOD captures', () => {
    const m = analyse([
      row(1, 'PRELIMINARY_POSITIVE', 'PRELIMINARY_POSITIVE'),
      row(2, 'PRELIMINARY_POSITIVE', 'PRELIMINARY_NEGATIVE'),
      row(3, 'PRELIMINARY_NEGATIVE', 'INCONCLUSIVE'),
      row(4, 'PRELIMINARY_NEGATIVE', 'PRELIMINARY_NEGATIVE', 'DAYLIGHT', 'POOR'),
    ]);
    expect(m.m1_accuracy).toBeCloseTo(2 / 3, 10);
    expect(m.m2_inconclusive_good).toBeCloseTo(1 / 3, 10);
  });
});
