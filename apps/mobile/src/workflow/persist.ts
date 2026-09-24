import { getDb } from '../adapters/db';
import type { Draft } from './draft';

/** EVD-08: the test draft is persisted on every change (ARCHITECTURE §5.3
 * "Every transition persists the draft for crash recovery"). It is working
 * state, not evidence; the capture files it names are the evidence. */

export function saveDraft(d: Draft): void {
  getDb().runSync(
    'INSERT OR REPLACE INTO test_draft (id, badge_id, updated_at, draft) VALUES (1, ?, ?, ?)',
    d.operator.badge_id,
    new Date().toISOString(),
    JSON.stringify(d)
  );
}

export function loadDraft(): { draft: Draft; updatedAt: string } | null {
  const row = getDb().getFirstSync<{ draft: string; updated_at: string }>('SELECT draft, updated_at FROM test_draft WHERE id = 1');
  if (!row) return null;
  try {
    return { draft: JSON.parse(row.draft) as Draft, updatedAt: row.updated_at };
  } catch {
    deleteDraft();
    return null;
  }
}

export function deleteDraft(): void {
  getDb().runSync('DELETE FROM test_draft WHERE id = 1');
}
