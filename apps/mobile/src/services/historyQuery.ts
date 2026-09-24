/** HIS-03 history filters → SQL over the test_index projection. Pure, so the
 * ≤ 300 ms @ 5,000 records target is measured in Node on the real schema. */

export interface HistoryFilters {
  /** Inclusive local dates, YYYY-MM-DD. */
  from?: string | null;
  to?: string | null;
  officer?: string | null;
  outcome?: 'PRELIMINARY_POSITIVE' | 'PRELIMINARY_NEGATIVE' | 'INCONCLUSIVE' | null;
  kitType?: string | null;
  /** Case number; matches anywhere in the case ID, case-insensitive. */
  caseId?: string | null;
  includeVoided?: boolean;
}

/** Local calendar day [start, end) as ISO UTC strings, for created_at comparisons. */
function dayStartIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
}
function nextDayStartIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d + 1).toISOString();
}

export function historyQuery(f: HistoryFilters): { sql: string; params: (string | number)[] } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.from) {
    where.push('t.created_at >= ?');
    params.push(dayStartIso(f.from));
  }
  if (f.to) {
    where.push('t.created_at < ?');
    params.push(nextDayStartIso(f.to));
  }
  if (f.officer?.trim()) {
    where.push('t.operator_badge = ?');
    params.push(f.officer.trim());
  }
  if (f.outcome) {
    where.push('t.outcome = ?');
    params.push(f.outcome);
  }
  if (f.kitType) {
    where.push('t.kit_type = ?');
    params.push(f.kitType);
  }
  if (f.caseId?.trim()) {
    where.push("t.case_id LIKE ? ESCAPE '\\'");
    params.push(`%${f.caseId.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  if (f.includeVoided === false) where.push('t.voided = 0');
  const sql = `SELECT t.*, COALESCE(o.status, 'PENDING') AS sync_status
       FROM test_index t LEFT JOIN sync_outbox o ON o.record_id = t.record_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY t.created_at DESC`;
  return { sql, params };
}

export function activeFilterCount(f: HistoryFilters): number {
  return [f.from, f.to, f.officer?.trim(), f.outcome, f.kitType, f.caseId?.trim()].filter(Boolean).length + (f.includeVoided === false ? 1 : 0);
}
