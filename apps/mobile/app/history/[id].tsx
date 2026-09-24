import { checkEnvelope, type TestRecord } from '@fdtc/evidence-core';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Text } from 'react-native';

import { getDeviceIdentity } from '@/src/adapters/keystore';
import { writeJsonFile } from '@/src/services/evidence';
import { envelopeById, evidencePath, exportLedger } from '@/src/services/ledger';
import { Button, C, Field, Note, Panel, Row, Screen } from '@/src/ui/kit';
import { ACTION_TEXT, OUTCOME_TEXT, pct, REASON_TEXT, when } from '@/src/ui/wording';

/** S-10 Record detail (HIS-02) and share (EXP-01). */
export default function RecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const envelope = envelopeById(id);
  const [sig, setSig] = useState('checking…');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!envelope) return;
    getDeviceIdentity().then((identity) => {
      const check = checkEnvelope(envelope, identity.publicKey);
      setSig(check.ok ? 'valid (ES256, this device)' : `FAILED — ${check.reason}`);
    });
  }, [envelope]);

  if (!envelope) {
    return (
      <Screen title="Record">
        <Note tone="bad">Record not found.</Note>
      </Screen>
    );
  }

  const r = envelope.record as unknown as TestRecord;
  const cls = r.classification;
  const photo = r.evidence_image ? evidencePath(r.evidence_image.sha256) : null;

  const shareJson = async () => {
    setError(null);
    try {
      // The full ledger export lets verify.html check this record's signature
      // (via GENESIS) and its position in the chain.
      const file = writeJsonFile(`fdtc-ledger-to-seq-${r.seq}.json`, await exportLedger());
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Share evidence record' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const sharePhoto = async () => {
    if (!photo) return;
    try {
      await Sharing.shareAsync(photo, { mimeType: 'image/jpeg', dialogTitle: 'Share original photo (send as a file)' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen
      title={`Record · seq ${r.seq}`}
      footer={
        <Row>
          <Button label="Share record JSON" onPress={shareJson} />
          <Button label="Share photo" kind="secondary" onPress={sharePhoto} disabled={!photo} />
        </Row>
      }>
      <Panel tone={OUTCOME_TEXT[cls.outcome].tone}>
        <Text style={{ color: C.text, fontSize: 19, fontWeight: '800' }}>{OUTCOME_TEXT[cls.outcome].title}</Text>
        {cls.outcome !== 'INCONCLUSIVE' ? <Text style={{ color: C.text }}>Colour-match confidence {pct(cls.confidence)}</Text> : null}
        {cls.inconclusive_reasons.map((x) => (
          <Note key={x}>• {REASON_TEXT[x] ?? x}</Note>
        ))}
        {cls.recommended_action ? <Text style={{ color: C.amber, fontWeight: '700' }}>{ACTION_TEXT[cls.recommended_action]}</Text> : null}
        <Note>{OUTCOME_TEXT[cls.outcome].always}</Note>
      </Panel>

      {photo ? <Image source={{ uri: photo }} style={{ width: '100%', aspectRatio: (r.evidence_image!.width || 3) / (r.evidence_image!.height || 4), borderRadius: 10 }} resizeMode="contain" /> : null}

      <Panel title="Integrity">
        <Field label="Signature" value={sig} />
        <Field label="Chain position" value={`seq ${r.seq}, follows ${r.prev_hash.slice(0, 16)}…`} mono />
        <Field label="Record hash" value={envelope.record_hash} mono />
        <Field label="Photo SHA-256" value={r.evidence_image?.sha256 ?? '— (no accepted photo)'} mono />
        <Field label="Captures" value={r.captures.map((c) => `#${c.n} ${c.accepted ? 'accepted' : `rejected (${c.reject_reasons.join(', ')})`}`).join('\n')} />
      </Panel>

      <Panel title="Details">
        <Field label="Created" value={when(r.created_at)} />
        <Field label="Operator" value={`badge ${r.operator.badge_id} (${r.operator.role.toLowerCase()})`} />
        <Field label="Kit" value={`${r.kit.display_name} (${r.kit.kit_type})`} />
        <Field label="Case / witness" value={`${r.case.case_id ?? '—'} / ${r.case.witness_badge_id ?? '—'}`} />
        <Field label="Card" value={r.calibration ? `${r.calibration.card_version} · ${r.calibration.card_status}` : '—'} />
        {r.measurement ? <Field label="Sample L*a*b*" value={r.measurement.lab.join(', ')} /> : null}
        {r.quality ? <Field label="Quality" value={`${r.quality.score} ${r.quality.band}`} /> : null}
        <Field
          label="Location"
          value={r.location ? `${r.location.lat}, ${r.location.lon} (±${r.location.accuracy_m ?? '?'} m)${r.location.mocked ? ' · MOCKED' : ''}` : 'unavailable'}
        />
        <Field label="Device integrity" value={`rooted: ${r.integrity.rooted ?? 'unknown'}`} />
        <Field label="Reference DB" value={`${r.reference_db.version} · ${r.reference_db.sha256.slice(0, 16)}…`} mono />
      </Panel>
      <Note>To verify independently: share the JSON and the photo (as a file, not a compressed image), then open verify.html.</Note>
      {error ? <Note tone="bad">{error}</Note> : null}
    </Screen>
  );
}
