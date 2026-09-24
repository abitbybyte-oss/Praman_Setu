/** Officer-facing wording (PRD §8.1, §8.2). Demo builds never name a substance. */

export const OUTCOME_TEXT: Record<string, { title: string; always: string; tone: 'good' | 'warn' | 'bad' }> = {
  PRELIMINARY_POSITIVE: {
    title: 'DEMO: Simulated Preliminary Positive',
    always: 'Presumptive result only. Laboratory confirmation required.',
    tone: 'bad',
  },
  PRELIMINARY_NEGATIVE: {
    title: 'DEMO: Simulated Preliminary Negative',
    always: 'No colour match to a positive reference. This does not rule out the presence of a substance.',
    tone: 'good',
  },
  INCONCLUSIVE: {
    title: 'DEMO: Inconclusive',
    always: 'All applicable reasons are listed with one recommended action.',
    tone: 'warn',
  },
};

export const REASON_TEXT: Record<string, string> = {
  IMAGE_BLURRY: 'Image too blurry',
  POOR_LIGHTING: 'Poor lighting',
  EXCESSIVE_GLARE: 'Excessive glare',
  REACTION_AREA_TOO_SMALL: 'Reaction area too small',
  CARD_CALIBRATION_FAILED: 'Card calibration failed',
  MULTIPLE_COLOURS: 'Multiple colours detected',
  MEASUREMENT_UNCERTAINTY_HIGH: 'Measurement uncertainty too high',
  OUTSIDE_REACTION_WINDOW: 'Captured outside reaction window',
  ABANDONED: 'Test ended before saving',
  OUTSIDE_REFERENCE_RANGE: 'Reaction outside reference range',
  REPEAT_ALSO_INCONCLUSIVE: 'Repeat test also inconclusive',
};

export const ACTION_TEXT: Record<string, string> = {
  RETAKE_PHOTO: 'Retake photograph — correctable capture issue',
  REPEAT_TEST: 'Repeat field test according to kit protocol',
  PRESERVE_FOR_LAB: 'Preserve sample for laboratory confirmation',
};

export const QUALITY_TEXT: Record<string, string> = {
  sharpness: 'sharpness',
  clipping: 'exposure',
  glare: 'glare',
  residual: 'calibration fit',
  uniformity: 'sample uniformity',
  area: 'sample area',
  card: 'card checks',
};

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function when(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}
