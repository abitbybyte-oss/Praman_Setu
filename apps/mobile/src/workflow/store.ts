import * as ExpoCrypto from 'expo-crypto';
import { create } from 'zustand';
import type { CornerId, Point, Circle } from '@fdtc/color-core';

import type { Operator } from '../services/auth';
import type { CardResult, SampleResult } from '../services/measure';
import { currentCapture, guards, type CaptureEntry, type Draft, type EndedEarly } from './draft';
import { deleteDraft, saveDraft } from './persist';
import type { KitScan } from '../services/kitqr';
import type { ReactionTimer } from './timer';

export { currentCapture, guards, type CaptureEntry, type Draft, type EndedEarly };

/** Session + test draft (ARCHITECTURE §5.1 "Workflow").
 *
 * The draft is working state, not evidence. Evidence starts with the first
 * capture file and becomes a record at Save. The guards below are the only
 * way screens move forward, so a screen cannot skip a step. */

interface State {
  operator: Operator | null;
  draft: Draft | null;
  /** KIT-03: result of the last kit QR scan, consumed by the kit screen. */
  pendingKit: KitScan | null;
  setPendingKit(k: KitScan | null): void;
  /** KIT-02: case ID and witness pre-filled on the next test. */
  lastCase: { caseId: string | null; witness: string | null };
  login(op: Operator): void;
  logout(): void;
  startTest(kitType: string, caseId: string | null, witness: string | null, kitScan: KitScan | null, study?: { truthClass: string; lighting: string } | null): void;
  /** TMR-02: record START TIMER once; it cannot be restarted for the same test. */
  setTimer(t: ReactionTimer): void;
  addCapture(c: Omit<CaptureEntry, 'n'>): CaptureEntry;
  /** Retake: the current accepted capture stays in the record, marked rejected. */
  rejectCurrent(reason: string): void;
  setCard(corners: Record<CornerId, Point>, snapped: boolean[], card: CardResult): void;
  clearCard(): void;
  setSample(roi: Circle, sample: SampleResult): void;
  endEarly(e: EndedEarly): void;
  clearDraft(): void;
  /** EVD-08: put a recovered draft back in play. */
  restoreDraft(d: Draft): void;
}

export const useSession = create<State>((set, get) => ({
  operator: null,
  draft: null,
  pendingKit: null,
  setPendingKit: (pendingKit) => set({ pendingKit }),
  lastCase: { caseId: null, witness: null },

  login: (operator) => set({ operator }),
  logout: () => set({ operator: null, draft: null }),

  startTest: (kitType, caseId, witness, kitScan, study = null) => {
    const operator = get().operator;
    if (!operator) throw new Error('sign in first');
    set({
      lastCase: { caseId, witness },
      draft: {
        recordId: ExpoCrypto.randomUUID(),
        startedAt: new Date().toISOString(),
        operator,
        kitType,
        kitScan,
        study,
        timer: null,
        caseId,
        witness,
        captures: [],
        corners: null,
        cornersSnapped: [],
        card: null,
        roi: null,
        sample: null,
        endedEarly: null,
      },
    });
  },

  addCapture: (c) => {
    const d = requireDraft(get().draft);
    const entry = { ...c, n: d.captures.length + 1 };
    // A new capture supersedes the previous accepted one; it stays in the record as retaken.
    const earlier = d.captures.map((k) => (k.accepted ? { ...k, accepted: false, reject_reasons: [...k.reject_reasons, 'RETAKEN'] } : k));
    set({ draft: { ...d, captures: [...earlier, entry], corners: null, card: null, roi: null, sample: null, endedEarly: null } });
    return entry;
  },

  rejectCurrent: (reason) => {
    const d = requireDraft(get().draft);
    const captures = d.captures.map((c) =>
      c.accepted && c === currentCapture(d) ? { ...c, accepted: false, reject_reasons: [...c.reject_reasons, reason] } : c
    );
    set({ draft: { ...d, captures, corners: null, card: null, roi: null, sample: null, endedEarly: null } });
  },

  setCard: (corners, snapped, card) => {
    const d = requireDraft(get().draft);
    set({ draft: { ...d, corners, cornersSnapped: snapped, card, roi: null, sample: null, endedEarly: null } });
  },
  clearCard: () => {
    const d = requireDraft(get().draft);
    set({ draft: { ...d, corners: null, card: null, roi: null, sample: null, endedEarly: null } });
  },

  setSample: (roi, sample) => {
    const d = requireDraft(get().draft);
    if (!guards.cardValid(d)) throw new Error('measure the sample only after a VALID card');
    set({ draft: { ...d, roi, sample, endedEarly: null } });
  },

  setTimer: (timer) => {
    const d = requireDraft(get().draft);
    if (d.timer) return;
    set({ draft: { ...d, timer } });
  },

  endEarly: (endedEarly) => set({ draft: { ...requireDraft(get().draft), endedEarly } }),
  clearDraft: () => {
    deleteDraft();
    set({ draft: null });
  },
  restoreDraft: (draft) => set({ draft }),
}));

// EVD-08: persist every draft change. Signing out keeps the stored draft, so an
// interrupted test is offered for recovery at the next sign-in; only an
// explicit clear (saved, or cancelled with no captures) removes it.
useSession.subscribe((state, prev) => {
  if (state.draft && state.draft !== prev.draft) saveDraft(state.draft);
});

function requireDraft(d: Draft | null): Draft {
  if (!d) throw new Error('no test in progress');
  return d;
}

