import * as ExpoCrypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { IDENTITY_AFFINE, measureRoi } from '@fdtc/color-core';

import { getDb, getSetting, setSetting } from '../adapters/db';
import { workingCopy } from './image';
import { finalClassification } from './recordBuilder';
import { kit } from './refdb';
import { toCsv, type StudyRow } from './studyCsv';
import { currentCapture, type Draft } from '../workflow/draft';

/** Validation-study mode (ARCHITECTURE §17): the tester states the true
 * swatch and lighting, and each measured capture becomes a CSV row. Rows are
 * stored apart from the evidence ledger and are never signed. */

export function studyMode(): boolean {
  return getSetting('study_mode') === 'on';
}

export function setStudyMode(on: boolean): void {
  setSetting('study_mode', on ? 'on' : 'off');
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function device(): string {
  const model = (Platform.constants as { Model?: string } | undefined)?.Model;
  return `${Platform.OS} ${Platform.Version}${model ? ` ${model}` : ''}`;
}

export async function recordStudyRow(d: Draft): Promise<StudyRow> {
  if (!d.study) throw new Error('not a study capture');
  const cap = currentCapture(d);
  const truth = kit(d.kitType).classes.find((c) => c.id === d.study!.truthClass);
  if (!truth) throw new Error('unknown study swatch');
  const c = finalClassification(d);
  const s = d.sample;
  let raw: [number, number, number] | null = null;
  if (cap && d.roi) raw = measureRoi((await workingCopy(cap.uri)).img, d.roi, IDENTITY_AFFINE).lab;
  const cal = d.card?.calibration;

  const row: StudyRow = {
    study_id: ExpoCrypto.randomUUID(),
    captured_at: cap?.taken_at ?? new Date().toISOString(),
    source: 'CAMERA',
    device: device(),
    lighting: d.study.lighting,
    kit_type: d.kitType,
    true_class: truth.id,
    true_outcome: truth.outcome,
    pred_outcome: c.outcome,
    pred_class: c.class_id ?? '',
    confidence: s ? Math.round(c.confidence * 1000) / 1000 : null,
    d1_de00: c.d1_de00 == null ? null : r2(c.d1_de00),
    d2_de00: c.d2_de00 == null ? null : r2(c.d2_de00),
    raw_L: raw ? r2(raw[0]) : null,
    raw_a: raw ? r2(raw[1]) : null,
    raw_b: raw ? r2(raw[2]) : null,
    cal_L: s ? r2(s.roi.lab[0]) : null,
    cal_a: s ? r2(s.roi.lab[1]) : null,
    cal_b: s ? r2(s.roi.lab[2]) : null,
    residual_de00_mean: cal && Number.isFinite(cal.residual_de00_mean) ? r2(cal.residual_de00_mean) : null,
    card_status: cal?.card_status ?? 'INVALID',
    quality_score: s?.quality.score ?? null,
    quality_band: s?.quality.band ?? 'POOR',
    reasons: c.inconclusive_reasons.join(' '),
  };
  getDb().runSync('INSERT INTO study_capture (study_id, captured_at, row) VALUES (?, ?, ?)', row.study_id, row.captured_at, JSON.stringify(row));

  // Study photos are not evidence: remove them once measured.
  for (const k of d.captures) {
    try {
      new File(k.uri).delete();
    } catch {
      // already gone
    }
  }
  return row;
}

export function studyRows(): StudyRow[] {
  return getDb()
    .getAllSync<{ row: string }>('SELECT row FROM study_capture ORDER BY captured_at')
    .map((r) => JSON.parse(r.row) as StudyRow);
}

export function studyCellCount(kitType: string, truthClass: string, lighting: string): number {
  return studyRows().filter((r) => r.kit_type === kitType && r.true_class === truthClass && r.lighting === lighting).length;
}

export function exportStudyCsv(): string {
  const dir = new Directory(Paths.document, 'exports');
  if (!dir.exists) dir.create({ intermediates: true });
  const csv = new File(dir, `fdtc-study-${new Date().toISOString().slice(0, 10)}.csv`);
  if (csv.exists) csv.delete();
  csv.create();
  csv.write(toCsv(studyRows()));
  return csv.uri;
}

export function clearStudy(): void {
  getDb().runSync('DELETE FROM study_capture');
}
