import type { Envelope, TestRecord } from '@fdtc/evidence-core';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { label, pct, S, when } from '@/src/i18n';
import { collectContext, raisedFlags, type CaptureContext } from '@/src/services/context';
import { kit, loadRefdb } from '@/src/services/refdb';
import { preview, saveTest } from '@/src/services/testRecord';
import { Button, C, Field, Note, Panel, Row, Screen } from '@/src/ui/kit';
import { guards, useSession } from '@/src/workflow/store';

/** S-08 Result (RES-01..04, RES-07, RES-09) and Save (EVD-01, EVD-02).
 * Time and location are fixed when this screen opens and shown before saving;
 * exactly those values go into the signed record. */

const TONE = { PRELIMINARY_POSITIVE: 'bad', PRELIMINARY_NEGATIVE: 'good', INCONCLUSIVE: 'warn' } as const;

export default function ResultScreen() {
  const draft = useSession((st) => st.draft);
  const operator = useSession((st) => st.operator);
  const rejectCurrent = useSession((st) => st.rejectCurrent);
  const clearDraft = useSession((st) => st.clearDraft);
  const [ctx, setCtx] = useState<CaptureContext | null>(null);
  const [saved, setSaved] = useState<Envelope<TestRecord> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (draft && !saved) collectContext().then(setCtx);
    // Collect once per result screen; a retake returns to capture and back here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (saved) {
    const r = saved.record;
    return (
      <Screen
        title={S.result.savedTitle}
        back={false}
        footer={
          <Row>
            <Button label={S.result.viewRecord} kind="secondary" onPress={() => router.replace(`/history/${r.record_id}`)} />
            <Button label={S.common.home} onPress={() => router.dismissTo('/home')} />
          </Row>
        }>
        <Panel tone="good" title={S.result.savedPanel}>
          <Note>{S.result.savedBody}</Note>
          <Field label={S.result.chainPos} value={`seq ${r.seq}`} />
          <Field label={S.result.recordHash} value={saved.record_hash} mono />
          <Field label={S.result.signature} value={`${saved.signature.alg} · ${saved.signature.key_id}`} mono />
          <Field label={S.result.photoHash} value={r.evidence_image?.sha256 ?? S.result.noPhoto} mono />
          <Field label={S.result.capturesRecorded} value={S.result.capturesRecordedLine(r.captures.length, r.retake_count)} />
        </Panel>
      </Screen>
    );
  }

  if (!draft || !operator || !guards.canSave(draft)) {
    return (
      <Screen title={S.result.title}>
        <Note>{S.result.noResult}</Note>
        <Button label={S.common.home} onPress={() => router.dismissTo('/home')} />
      </Screen>
    );
  }

  const cls = preview(draft);
  const wording = S.outcome[cls.outcome];
  const s = draft.sample;
  const cal = draft.card?.calibration;
  const profile = kit(draft.kitType);
  const loc = ctx?.location;

  const save = async () => {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    try {
      const env = await saveTest(draft, ctx);
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
      title={S.result.title}
      footer={
        <Row>
          {!draft.endedEarly ? <Button label={S.result.retake} kind="secondary" onPress={retake} disabled={busy} /> : null}
          <Button label={S.result.save} onPress={save} busy={busy || !ctx} />
        </Row>
      }>
      <Panel tone={TONE[cls.outcome]}>
        <Text style={{ color: C.text, fontSize: 21, fontWeight: '800' }}>{wording.title}</Text>
        {cls.outcome !== 'INCONCLUSIVE' ? <Text style={{ color: C.text, fontSize: 16 }}>{S.result.confidence(pct(cls.confidence))}</Text> : null}
        <Note>{wording.always}</Note>
      </Panel>

      {cls.inconclusive_reasons.length ? (
        <Panel tone="warn" title={S.result.reasons}>
          {cls.inconclusive_reasons.map((r) => (
            <Note key={r}>• {label(S.reason, r)}</Note>
          ))}
          {cls.recommended_action ? (
            <Text style={{ color: C.amber, fontSize: 15, fontWeight: '700' }}>{label(S.action, cls.recommended_action)}</Text>
          ) : null}
        </Panel>
      ) : null}

      <Panel title={S.result.measurement}>
        <Field
          label={S.result.card}
          value={
            cal
              ? S.result.cardLine(cal.card_status, Number.isFinite(cal.residual_de00_mean) ? cal.residual_de00_mean.toFixed(2) : null)
              : S.result.notCalibrated
          }
        />
        {s ? (
          <>
            <Field
              label={S.result.nearest}
              value={S.result.nearestLine(cls.class_label ?? S.common.dash, cls.d1_de00?.toFixed(2) ?? S.common.dash, cls.d2_de00?.toFixed(2) ?? S.common.dash)}
            />
            <Field label={S.result.labLine} value={s.roi.lab.map((v) => v.toFixed(1)).join(', ')} />
            <Field label={S.result.uncertainty} value={S.result.uncertaintyLine(cls.uncertainty_de00.toFixed(2), s.roi.spread_de00_p90.toFixed(2))} />
            <Field
              label={S.result.quality}
              value={S.result.qualityLine(
                s.quality.score,
                s.quality.band,
                s.quality.reasons.length ? s.quality.reasons.map((q) => label(S.qualityComponent, q)).join(', ') : null
              )}
            />
          </>
        ) : null}
      </Panel>

      <Panel title={S.result.details}>
        <Field label={S.result.time} value={ctx ? when(ctx.clock.device_time) : S.result.locating} />
        <Field
          label={S.result.location}
          value={
            !ctx
              ? S.result.locating
              : loc
                ? S.result.locationLine(loc.lat, loc.lon, loc.accuracy_m == null ? '?' : String(loc.accuracy_m), loc.mocked === true)
                : S.result.locationNone
          }
        />
        <Field label={S.result.operator} value={S.result.operatorLine(draft.operator.name, draft.operator.badge_id)} />
        <Field label={S.result.kit} value={S.result.kitLine(profile.display_name, draft.kitType)} />
        <Field label={S.result.caseId} value={draft.caseId ?? S.common.dash} />
        <Field label={S.result.witness} value={draft.witness ?? S.common.dash} />
        <Field label={S.result.captures} value={S.result.capturesLine(draft.captures.length)} />
        <Field label={S.result.refdb} value={loadRefdb().version} />
      </Panel>

      {ctx ? (
        <Panel title={S.integrity.title} tone={raisedFlags(ctx.integrity).length ? 'warn' : undefined}>
          {raisedFlags(ctx.integrity).length === 0 ? <Note>{S.integrity.none}</Note> : null}
          {raisedFlags(ctx.integrity).map((f) => (
            <Note key={f} tone="warn">• {S.integrity.flags[f]}</Note>
          ))}
          <Note>{S.integrity.clockLine(ctx.clock.skew_s === null ? null : String(ctx.clock.skew_s))}</Note>
          <Note>{S.integrity.note}</Note>
        </Panel>
      ) : null}
      {error ? <Note tone="bad">{error}</Note> : null}
    </Screen>
  );
}
