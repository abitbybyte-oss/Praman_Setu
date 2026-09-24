import { beforeAll, describe, expect, it } from 'vitest';

import { MIGRATION_1, MIGRATION_2 } from '../../adapters/schema';
import { historyQuery, type HistoryFilters } from '../historyQuery';

// Vite does not know node:sqlite yet; load it through Node directly.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = InstanceType<typeof DatabaseSync>;

const N = 5000;
const OUTCOMES = ['PRELIMINARY_POSITIVE', 'PRELIMINARY_NEGATIVE', 'INCONCLUSIVE'];
const KITS = ['SIM-A', 'SIM-B', 'SIM-C', 'SIM-D'];
const BADGES = ['1001', '1002', '1003', '1004', '1005'];
let db: DatabaseSync;

beforeAll(() => {
  db = new DatabaseSync(':memory:');
  db.exec(MIGRATION_1);
  db.exec(MIGRATION_2);
  const ins = db.prepare(
    'INSERT INTO test_index (record_id, seq, created_at, operator_badge, kit_type, case_id, outcome, confidence, quality_score, voided) VALUES (?,?,?,?,?,?,?,?,?,?)'
  );
  const t0 = new Date(2026, 0, 1).getTime();
  db.exec('BEGIN');
  for (let i = 0; i < N; i++) {
    ins.run(
      `r${i}`,
      i + 1,
      new Date(t0 + i * 90 * 60_000).toISOString(), // every 90 min → ~312 days
      BADGES[i % BADGES.length],
      KITS[i % KITS.length],
      i % 7 === 0 ? null : `FIR-${String(i % 400).padStart(4, '0')}-2026`,
      OUTCOMES[i % 3],
      0.8,
      90,
      i % 50 === 0 ? 1 : 0
    );
  }
  db.exec('COMMIT');
});

function run(f: HistoryFilters) {
  const { sql, params } = historyQuery(f);
  const t = performance.now();
  const rows = db.prepare(sql).all(...params) as { created_at: string; outcome: string; kit_type: string; operator_badge: string; case_id: string | null; voided: number }[];
  return { rows, ms: performance.now() - t };
}

describe('HIS-03 history filters on 5,000 records', () => {
  it('no filter returns everything, newest first', () => {
    const { rows } = run({});
    expect(rows.length).toBe(N);
    expect(rows[0].created_at > rows[1].created_at).toBe(true);
  });

  it('each filter narrows correctly', () => {
    expect(run({ outcome: 'INCONCLUSIVE' }).rows.every((r) => r.outcome === 'INCONCLUSIVE')).toBe(true);
    expect(run({ kitType: 'SIM-C' }).rows.every((r) => r.kit_type === 'SIM-C')).toBe(true);
    expect(run({ officer: '1003' }).rows.every((r) => r.operator_badge === '1003')).toBe(true);
    const c = run({ caseId: 'fir-0042' }).rows;
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((r) => r.case_id?.toUpperCase().includes('FIR-0042'))).toBe(true);
    expect(run({ includeVoided: false }).rows.every((r) => r.voided === 0)).toBe(true);
  });

  it('date range is inclusive of whole local days', () => {
    const { rows } = run({ from: '2026-01-02', to: '2026-01-02' });
    expect(rows.length).toBe(16); // 24 h / 90 min
    for (const r of rows) {
      const d = new Date(r.created_at);
      expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 0, 2]);
    }
  });

  it('combined filters', () => {
    const { rows } = run({ from: '2026-02-01', to: '2026-03-31', officer: '1002', outcome: 'PRELIMINARY_POSITIVE', kitType: 'SIM-A' });
    expect(rows.every((r) => r.operator_badge === '1002' && r.outcome === 'PRELIMINARY_POSITIVE' && r.kit_type === 'SIM-A')).toBe(true);
  });

  it('case search treats % and _ literally', () => {
    expect(run({ caseId: '%' }).rows.length).toBe(0);
    expect(run({ caseId: '_' }).rows.length).toBe(0);
  });

  it('≤ 300 ms for every filter combination (PRD HIS-03)', () => {
    const combos: HistoryFilters[] = [{}, { outcome: 'INCONCLUSIVE' }, { caseId: '12' }, { from: '2026-03-01', to: '2026-06-30', kitType: 'SIM-B' }, { officer: '1001', caseId: 'FIR' }];
    const worst = Math.max(...combos.map((f) => run(f).ms));
    expect(worst).toBeLessThan(300);
  });
});
