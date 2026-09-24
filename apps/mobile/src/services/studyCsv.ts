/** Validation-study rows (PRD M1–M4, ARCHITECTURE §17 "Validation study").
 * Pure: shared by the app's study mode and tools/validation-study.
 *
 * A study row is NOT evidence: it is never signed or put in the ledger. The
 * tester states the true swatch and the lighting before capturing. */

export const LIGHTING = ['DAYLIGHT', 'LED_COOL', 'TUNGSTEN_WARM', 'DIM_INDOOR'] as const;
export type Lighting = (typeof LIGHTING)[number];

export interface StudyRow {
  study_id: string;
  captured_at: string;
  source: 'CAMERA' | 'SYNTHETIC';
  device: string;
  lighting: string;
  kit_type: string;
  true_class: string;
  true_outcome: string;
  pred_outcome: string;
  pred_class: string;
  confidence: number | null;
  d1_de00: number | null;
  d2_de00: number | null;
  raw_L: number | null;
  raw_a: number | null;
  raw_b: number | null;
  cal_L: number | null;
  cal_a: number | null;
  cal_b: number | null;
  residual_de00_mean: number | null;
  card_status: string;
  quality_score: number | null;
  quality_band: string;
  reasons: string;
}

export const STUDY_COLUMNS: (keyof StudyRow)[] = [
  'study_id', 'captured_at', 'source', 'device', 'lighting', 'kit_type', 'true_class', 'true_outcome',
  'pred_outcome', 'pred_class', 'confidence', 'd1_de00', 'd2_de00', 'raw_L', 'raw_a', 'raw_b',
  'cal_L', 'cal_a', 'cal_b', 'residual_de00_mean', 'card_status', 'quality_score', 'quality_band', 'reasons',
];

const NUMERIC = new Set<keyof StudyRow>(['confidence', 'd1_de00', 'd2_de00', 'raw_L', 'raw_a', 'raw_b', 'cal_L', 'cal_a', 'cal_b', 'residual_de00_mean', 'quality_score']);

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: StudyRow[]): string {
  return [STUDY_COLUMNS.join(','), ...rows.map((r) => STUDY_COLUMNS.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

/** RFC 4180-ish parser (quotes, escaped quotes, embedded commas/newlines). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) out.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((f) => f !== '')) out.push(row);
  }
  return out;
}

export function fromCsv(text: string): StudyRow[] {
  const [header, ...lines] = parseCsv(text);
  if (!header) return [];
  return lines.map((cells) => {
    const r: Record<string, unknown> = {};
    header.forEach((h, i) => {
      const v = cells[i] ?? '';
      r[h] = NUMERIC.has(h as keyof StudyRow) ? (v === '' ? null : Number(v)) : v;
    });
    return r as unknown as StudyRow;
  });
}
