import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { label, S } from '@/src/i18n';
import { kit as kitProfile, kits, loadRefdb } from '@/src/services/refdb';
import { LIGHTING } from '@/src/services/studyCsv';
import { studyMode } from '@/src/services/studyStore';
import { Button, C, Field, Note, Panel, Screen } from '@/src/ui/kit';
import { useSession } from '@/src/workflow/store';

/** S-03 Kit (KIT-01..05): scan the kit QR (preferred) or select manually;
 * case ID + witness. Only a VALID scanned kit, or a manual selection, may
 * continue; anything else is blocked. */
export default function KitScreen() {
  const lastCase = useSession((st) => st.lastCase);
  const startTest = useSession((st) => st.startTest);
  const scan = useSession((st) => st.pendingKit);
  const setPendingKit = useSession((st) => st.setPendingKit);
  const [manualType, setManualType] = useState<string | null>(null);
  const [caseId, setCaseId] = useState(lastCase.caseId ?? '');
  const [witness, setWitness] = useState(lastCase.witness ?? '');
  const study = studyMode();
  const [truth, setTruth] = useState<string | null>(null);
  const [lighting, setLighting] = useState<string | null>(null);

  const scannedValid = scan?.status === 'VALID' && scan.kit ? scan.kit.kit_type : null;
  const kitType = scan ? scannedValid : manualType;
  const blocked = !!scan && scan.status !== 'VALID';

  const studyReady = !study || (!!truth && !!lighting && !!kitType && kitProfile(kitType).classes.some((c) => c.id === truth));
  const start = () => {
    if (!kitType || blocked || !studyReady) return;
    startTest(kitType, caseId.trim() || null, witness.trim() || null, scan && scan.status === 'VALID' ? scan : null, study ? { truthClass: truth!, lighting: lighting! } : null);
    setPendingKit(null);
    router.push(study ? '/test/capture' : '/test/timer');
  };

  const statusTone = !scan ? undefined : scan.status === 'VALID' ? 'good' : 'bad';

  return (
    <Screen title={S.kit.title} footer={<Button label={S.kit.continue} onPress={start} disabled={!kitType || blocked || !studyReady} />}>
      <Button label={S.kit.scan} onPress={() => router.push('/test/scan')} />

      {scan ? (
        <Panel title={S.kit.summary} tone={statusTone}>
          <Text style={{ color: scan.status === 'VALID' ? C.green : C.red, fontSize: 20, fontWeight: '800' }}>{label(S.kit.status, scan.status)}</Text>
          {blocked ? <Text style={{ color: C.red, fontSize: 16, fontWeight: '700' }}>{S.kit.notValid}</Text> : null}
          {scan.problem ? <Note tone="bad">{label(S.kit.problem, scan.problem)}</Note> : null}
          {scan.status === 'EXPIRED' && scan.kit ? <Note tone="bad">{S.kit.expiredNote(scan.kit.expiry_date)}</Note> : null}
          {scan.status === 'NOT_YET_VALID' && scan.kit ? <Note tone="bad">{S.kit.notYetNote(scan.kit.mfg_date)}</Note> : null}
          {scan.kit ? (
            <>
              <Field label={S.kit.fields.type} value={`${loadRefdb().db.kits[scan.kit.kit_type]?.display_name ?? scan.kit.kit_type} (${scan.kit.kit_type})`} />
              <Field label={S.kit.fields.id} value={scan.kit.kit_id} />
              <Field label={S.kit.fields.manufacturer} value={scan.kit.manufacturer} />
              <Field label={S.kit.fields.batch} value={scan.kit.batch} />
              <Field label={S.kit.fields.mfg} value={scan.kit.mfg_date} />
              <Field label={S.kit.fields.expiry} value={scan.kit.expiry_date} />
            </>
          ) : null}
          {scan.status === 'VALID' ? <Note>{S.kit.lockedType}</Note> : null}
          <Button label={S.kit.clear} kind="ghost" onPress={() => setPendingKit(null)} />
        </Panel>
      ) : (
        <Panel title={S.kit.kitType}>
          <Note>{S.kit.orManual}</Note>
          {kits().map(([type, k]) => (
            <Pressable key={type} onPress={() => setManualType(type)} style={[styles.kit, manualType === type && styles.selected]}>
              <Text style={styles.kitName}>{k.display_name}</Text>
              <Text style={styles.kitMeta}>{S.kit.kitMeta(type, k.protocol.required_s, k.protocol.max_s)}</Text>
            </Pressable>
          ))}
        </Panel>
      )}

      {study ? (
        <Panel title={S.study.banner} tone="warn">
          <Text style={styles.label}>{S.study.truth}</Text>
          {kitType ? (
            kitProfile(kitType).classes.map((c) => (
              <Pressable key={c.id} onPress={() => setTruth(c.id)} style={[styles.kit, truth === c.id && styles.selected]}>
                <Text style={styles.kitName}>{c.label}</Text>
                <Text style={styles.kitMeta}>{c.id}</Text>
              </Pressable>
            ))
          ) : (
            <Note>{S.kit.orManual}</Note>
          )}
          <Text style={styles.label}>{S.study.lighting}</Text>
          {LIGHTING.map((l) => (
            <Pressable key={l} onPress={() => setLighting(l)} style={[styles.kit, lighting === l && styles.selected]}>
              <Text style={styles.kitName}>{S.study.lightingNames[l]}</Text>
            </Pressable>
          ))}
        </Panel>
      ) : null}

      <Panel title={S.kit.case}>
        <Text style={styles.label}>{S.kit.caseId}</Text>
        <TextInput style={styles.input} value={caseId} onChangeText={setCaseId} autoCapitalize="characters" placeholder={S.kit.caseIdPlaceholder} placeholderTextColor={C.dim} />
        <Text style={styles.label}>{S.kit.witness}</Text>
        <TextInput style={styles.input} value={witness} onChangeText={setWitness} keyboardType="number-pad" placeholder={S.kit.optional} placeholderTextColor={C.dim} />
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  kit: { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, gap: 2 },
  selected: { borderColor: C.link, backgroundColor: '#1b2640' },
  kitName: { color: C.text, fontSize: 16, fontWeight: '700' },
  kitMeta: { color: C.muted, fontSize: 13 },
  label: { color: C.muted, fontSize: 13 },
  input: { backgroundColor: C.bg, borderColor: C.border, borderWidth: 1, borderRadius: 8, color: C.text, fontSize: 16, paddingHorizontal: 12, paddingVertical: 10 },
});
