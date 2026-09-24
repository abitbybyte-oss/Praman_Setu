import type { Envelope, TestRecord } from '@fdtc/evidence-core';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { kit, loadRefdb } from '@/src/services/refdb';
import { preview, saveTest } from '@/src/services/testRecord';
import { Button, C, Field, Note, Panel, Row, Screen } from '@/src/ui/kit';
import { ACTION_TEXT, OUTCOME_TEXT, pct, QUALITY_TEXT, REASON_TEXT } from '@/src/ui/wording';
import { guards, useSession } from '@/src/workflow/store';

/** S-08 Result (RES-01..04, RES-07) and Save (EVD-01, EVD-02). */
export default function ResultScreen() {
  const draft = useSession((st) => st.draft);
  const operator = useSession((st) => st.operator);
  const rejectCurrent = useSession((st) => st.rejectCurrent);
  const clearDraft = useSession((st) => st.clearDraft);
  const [saved, setSaved] = useState<Envelope<TestRecord> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (saved) {
    const r = saved.record;
    return (
      <Screen
        title="Saved"
        back={false}
        footer={
          <Row>
            <Button label="View record" kind="secondary" onPress={() => router.replace(`/history/${r.record_id}`)} />
            <Button label="Home" onPress={() => router.dismissTo('/home')} />
          </Row>
        }>
        <Panel tone="good" title="Signed and chained">
          <Note>The record is in the device ledger. Any later change to it or to the photo is detectable.</Note>
          <Field label="Chain position" value={`seq ${r.seq}`} />
          <Field label="Record hash" value={saved.record_hash} mono />
          <Field label="Signature" value={`${saved.signature.alg} · ${saved.signature.key_id}`} mono />
          <Field label="Photo SHA-256" value={r.evidence_image?.sha256 ?? '— (no accepted photo)'} mono />
          <Field label="Captures recorded" value={`${r.captures.length} (retakes: ${r.retake_count})`} />
        </Panel>
      </Screen>
    );
  }

  if (!draft || !operator || !guards.canSave(draft)) {
    return (
      <Screen title="Result">
        <Note>No result to show.</Note>
        <Button label="Home" onPress={() => router.dismissTo('/home')} />
      </Screen>
    );
  }

  const cls = preview(draft);
  const wording = OUTCOME_TEXT[cls.outcome];
  const s = draft.sample;
  const cal = draft.card?.calibration;
  const profile = kit(draft.kitType);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const env = await saveTest(draft, operator);
      clearDraft();
      setSaved(env);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const retake = () => {
    rejectCurrent('RETAKEN');
    router.dismissTo('/test/capture');
  };

  return (
    <Screen
      title="Result"
      footer={
        <Row>
          {!draft.endedEarly ? <Button label="Retake" kind="secondary" onPress={retake} disabled={busy} /> : null}
          <Button label="Save & sign" onPress={save} busy={busy} />
        </Row>
      }>
      <Panel tone={wording.tone}>
        <Text style={{ color: C.text, fontSize: 21, fontWeight: '800' }}>{wording.title}</Text>
        {cls.outcome !== 'INCONCLUSIVE' ? (
          <Text style={{ color: C.text, fontSize: 16 }}>Colour-match confidence {pct(cls.confidence)}</Text>
        ) : null}
        <Note>{wording.always}</Note>
      </Panel>

      {cls.inconclusive_reasons.length ? (
        <Panel tone="warn" title="Reasons">
          {cls.inconclusive_reasons.map((r) => (
            <Note key={r}>• {REASON_TEXT[r] ?? r}</Note>
          ))}
          {cls.recommended_action ? (
            <Text style={{ color: C.amber, fontSize: 15, fontWeight: '700' }}>{ACTION_TEXT[cls.recommended_action]}</Text>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="Measurement">
        <Field label="Card" value={cal ? `${cal.card_status}${Number.isFinite(cal.residual_de00_mean) ? ` · mean ΔE00 ${cal.residual_de00_mean.toFixed(2)}` : ''}` : 'not calibrated'} />
        {s ? (
          <>
            <Field
              label="Nearest reference"
              value={`${cls.class_label ?? '—'} · ΔE00 ${cls.d1_de00?.toFixed(2) ?? '—'} (next other outcome ${cls.d2_de00?.toFixed(2) ?? '—'})`}
            />
            <Field label="Sample colour (L*a*b*)" value={s.roi.lab.map((v) => v.toFixed(1)).join(', ')} />
            <Field label="Uncertainty" value={`±${cls.uncertainty_de00.toFixed(2)} ΔE00 · spread p90 ${s.roi.spread_de00_p90.toFixed(2)}`} />
            <Field
              label="Capture quality"
              value={`${s.quality.score} ${s.quality.band}${s.quality.reasons.length ? ` · weakest: ${s.quality.reasons.map((q) => QUALITY_TEXT[q] ?? q).join(', ')}` : ''}`}
            />
          </>
        ) : null}
      </Panel>

      <Panel title="Record details">
        <Field label="Operator" value={`${operator.name} (badge ${operator.badge_id})`} />
        <Field label="Kit" value={`${profile.display_name} (${draft.kitType}) · manual selection`} />
        <Field label="Case ID" value={draft.caseId ?? '—'} />
        <Field label="Witness" value={draft.witness ?? '—'} />
        <Field label="Captures" value={`${draft.captures.length} (every capture's hash is recorded)`} />
        <Field label="Reference DB" value={loadRefdb().version} />
        <Note>Time and GPS location are taken at save.</Note>
      </Panel>
      {error ? <Note tone="bad">{error}</Note> : null}
    </Screen>
  );
}
