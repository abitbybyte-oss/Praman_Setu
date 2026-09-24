import { checkEnvelope, type TestRecord } from '@fdtc/evidence-core';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, TextInput } from 'react-native';
import { VOID_REASON_MIN } from '@fdtc/evidence-core';

import { getDeviceIdentity } from '@/src/adapters/keystore';
import { label, pct, S, when } from '@/src/i18n';
import { writeJsonFile } from '@/src/services/evidence';
import { envelopeById, evidencePath, exportLedger, voidFor } from '@/src/services/ledger';
import { raisedFlags } from '@/src/services/context';
import { makeReportPdf } from '@/src/services/report';
import { voidTest } from '@/src/services/void';
import { useSession } from '@/src/workflow/store';
import { Button, C, Field, Note, Panel, Row, Screen } from '@/src/ui/kit';

/** S-10 Record detail (HIS-02) and share (EXP-01). */

const TONE = { PRELIMINARY_POSITIVE: 'bad', PRELIMINARY_NEGATIVE: 'good', INCONCLUSIVE: 'warn' } as const;

export default function RecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const envelope = envelopeById(id);
  const [sig, setSig] = useState(S.record.sigChecking);
  const [error, setError] = useState<string | null>(null);
  const operator = useSession((st) => st.operator);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0); // re-read after a void

  useEffect(() => {
    if (!envelope) return;
    getDeviceIdentity().then((identity) => {
      const check = checkEnvelope(envelope, identity.publicKey);
      setSig(check.ok ? S.record.sigValid : S.record.sigFailed(check.reason));
    });
  }, [envelope]);

  if (!envelope) {
    return (
      <Screen title={S.record.notFound}>
        <Note tone="bad">{S.record.notFound}</Note>
      </Screen>
    );
  }

  const r = envelope.record as unknown as TestRecord;
  const cls = r.classification;
  const wording = S.outcome[cls.outcome];
  const photo = r.evidence_image ? evidencePath(r.evidence_image.sha256) : null;

  const shareJson = async () => {
    setError(null);
    try {
      // The full ledger export lets verify.html check this record's signature
      // (via GENESIS) and its position in the chain.
      const file = writeJsonFile(`fdtc-ledger-to-seq-${r.seq}.json`, await exportLedger());
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: S.record.shareJsonTitle });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const sharePdf = async () => {
    setError(null);
    setBusy(true);
    try {
      const uri = await makeReportPdf(envelope as never);
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: S.pdf.shareTitle, UTI: 'com.adobe.pdf' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sharePhoto = async () => {
    if (!photo) return;
    try {
      await Sharing.shareAsync(photo, { mimeType: 'image/jpeg', dialogTitle: S.record.sharePhotoTitle });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loc = r.location;
  const v = voidFor(r.record_id);
  void version;

  const confirmVoid = async () => {
    if (!operator) return;
    setBusy(true);
    setError(null);
    try {
      await voidTest(r.record_id, reason, operator);
      setVoiding(false);
      setReason('');
      setVersion((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title={S.record.title(r.seq)}
      footer={
        <>
          <Button label={busy ? S.pdf.making : S.pdf.make} onPress={sharePdf} busy={busy} />
          <Row>
            <Button label={S.record.shareJson} kind="secondary" onPress={shareJson} />
            <Button label={S.record.sharePhoto} kind="secondary" onPress={sharePhoto} disabled={!photo} />
          </Row>
        </>
      }>
      {v ? (
        <Panel tone="bad" title={S.record.voidedTitle}>
          <Note tone="bad">{S.record.voidedBody(v.operator.badge_id, when(v.created_at), v.reason)}</Note>
          <Note>{S.record.voidedNote}</Note>
        </Panel>
      ) : null}

      <Panel tone={TONE[cls.outcome]}>
        <Text style={[{ color: C.text, fontSize: 19, fontWeight: '800' }, v ? styles.struck : null]}>{wording.title}</Text>
        {cls.outcome !== 'INCONCLUSIVE' ? <Text style={{ color: C.text }}>{S.result.confidence(pct(cls.confidence))}</Text> : null}
        {cls.inconclusive_reasons.map((x) => (
          <Note key={x}>• {label(S.reason, x)}</Note>
        ))}
        {cls.recommended_action ? <Text style={{ color: C.amber, fontWeight: '700' }}>{label(S.action, cls.recommended_action)}</Text> : null}
        <Note>{wording.always}</Note>
      </Panel>

      {photo ? (
        <Image
          source={{ uri: photo }}
          style={{ width: '100%', aspectRatio: (r.evidence_image!.width || 3) / (r.evidence_image!.height || 4), borderRadius: 10 }}
          resizeMode="contain"
        />
      ) : null}

      <Panel title={S.record.integrity}>
        <Field label={S.record.signature} value={sig} />
        <Field label={S.record.chainPos} value={S.record.chainLine(r.seq, r.prev_hash.slice(0, 16))} mono />
        <Field label={S.result.recordHash} value={envelope.record_hash} mono />
        <Field label={S.result.photoHash} value={r.evidence_image?.sha256 ?? S.result.noPhoto} mono />
        <Field
          label={S.record.captures}
          value={r.captures
            .map((c) => (c.accepted ? S.record.captureAccepted(c.n) : S.record.captureRejected(c.n, c.reject_reasons.map((x) => label(S.reason, x)).join(', '))))
            .join('\n')}
        />
      </Panel>

      <Panel title={S.record.details}>
        <Field label={S.record.created} value={when(r.created_at)} />
        <Field label={S.result.operator} value={S.record.operatorLine(r.operator.badge_id, label(S.role, r.operator.role))} />
        <Field
          label={S.result.kit}
          value={`${r.kit.display_name} (${r.kit.kit_type}) · ${label(S.kit.status, r.kit.status)}${r.kit.kit_id ? ` · ${r.kit.kit_id} · ${r.kit.batch} · exp ${r.kit.expiry_date}` : ''}`}
        />
        <Field
          label={S.result.timingSection}
          value={
            r.timing.timer === 'NONE'
              ? S.result.timingNoTimer
              : `${S.result.seconds(String(r.timing.elapsed_s ?? '—'))} / ${S.result.seconds(String(r.timing.required_s))}–${S.result.seconds(String(r.timing.max_s))} · ${
                  r.timing.in_window === false ? S.result.no : S.result.yes
                }${r.timing.timer === 'DEMO_PROTOCOL' ? S.result.demoProtocol : ''}`
          }
        />
        <Field label={S.record.caseWitness} value={`${r.case.case_id ?? S.common.dash} / ${r.case.witness_badge_id ?? S.common.dash}`} />
        <Field label={S.result.card} value={r.calibration ? `${r.calibration.card_version} · ${r.calibration.card_status}` : S.common.dash} />
        {r.measurement ? <Field label={S.record.sampleLab} value={r.measurement.lab.join(', ')} /> : null}
        {r.quality ? <Field label={S.result.quality} value={`${r.quality.score} ${r.quality.band}`} /> : null}
        <Field
          label={S.result.location}
          value={loc ? S.result.locationLine(loc.lat, loc.lon, loc.accuracy_m == null ? '?' : String(loc.accuracy_m), loc.mocked === true) : S.record.unavailable}
        />
        <Field
          label={S.record.integrityFlags}
          value={[
            ...(raisedFlags(r.integrity).length ? raisedFlags(r.integrity).map((f) => S.integrity.flags[f]) : [S.integrity.none]),
            S.integrity.clockLine(r.clock.skew_s === null ? null : String(r.clock.skew_s)),
          ].join('\n')}
        />
        <Field label={S.result.refdb} value={`${r.reference_db.version} · ${r.reference_db.sha256.slice(0, 16)}…`} mono />
      </Panel>
      <Note>{S.record.verifyHint}</Note>

      {!v && operator?.role === 'OFFICER' ? (
        voiding ? (
          <Panel tone="bad" title={S.record.voidTitle}>
            <Note>{S.record.voidExplain}</Note>
            <Text style={styles.label}>{S.record.voidReason}</Text>
            <TextInput
              style={styles.input}
              value={reason}
              onChangeText={setReason}
              multiline
              placeholder={S.record.voidReasonPlaceholder}
              placeholderTextColor={C.dim}
            />
            {reason.trim().length < VOID_REASON_MIN ? <Note>{S.record.voidTooShort(VOID_REASON_MIN)}</Note> : null}
            <Row>
              <Button label={S.record.voidCancel} kind="secondary" onPress={() => setVoiding(false)} disabled={busy} />
              <Button label={S.record.voidConfirm} kind="danger" onPress={confirmVoid} busy={busy} disabled={reason.trim().length < VOID_REASON_MIN} />
            </Row>
          </Panel>
        ) : (
          <Button label={S.record.voidAction} kind="danger" onPress={() => setVoiding(true)} />
        )
      ) : null}
      {error ? <Note tone="bad">{error}</Note> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  struck: { textDecorationLine: 'line-through' },
  label: { color: C.muted, fontSize: 13 },
  input: { backgroundColor: C.bg, borderColor: C.border, borderWidth: 1, borderRadius: 8, color: C.text, fontSize: 15, padding: 10, minHeight: 70, textAlignVertical: 'top' },
});
