import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { kits } from '@/src/services/refdb';
import { Button, C, Note, Panel, Screen } from '@/src/ui/kit';
import { useSession } from '@/src/workflow/store';

/** S-03 Kit selection (KIT-01 manual select, KIT-02 case ID + witness). */
export default function KitScreen() {
  const lastCase = useSession((st) => st.lastCase);
  const startTest = useSession((st) => st.startTest);
  const [kitType, setKitType] = useState<string | null>(null);
  const [caseId, setCaseId] = useState(lastCase.caseId ?? '');
  const [witness, setWitness] = useState(lastCase.witness ?? '');

  const start = () => {
    if (!kitType) return;
    startTest(kitType, caseId.trim() || null, witness.trim() || null);
    router.push('/test/capture');
  };

  return (
    <Screen title="New test — kit" footer={<Button label="Continue to capture" onPress={start} disabled={!kitType} />}>
      <Panel title="Kit type (simulated profiles)">
        {kits().map(([type, k]) => (
          <Pressable key={type} onPress={() => setKitType(type)} style={[styles.kit, kitType === type && styles.selected]}>
            <Text style={styles.kitName}>{k.display_name}</Text>
            <Text style={styles.kitMeta}>
              {type} · read at {k.protocol.required_s}s, before {k.protocol.max_s}s
            </Text>
          </Pressable>
        ))}
        <Note>Kit QR scanning and the reaction timer arrive in a later phase; select the kit manually.</Note>
      </Panel>

      <Panel title="Case (optional)">
        <Text style={styles.label}>Case ID / FIR number</Text>
        <TextInput style={styles.input} value={caseId} onChangeText={setCaseId} autoCapitalize="characters" placeholder="FIR-0419-2026" placeholderTextColor={C.dim} />
        <Text style={styles.label}>Witness badge ID</Text>
        <TextInput style={styles.input} value={witness} onChangeText={setWitness} keyboardType="number-pad" placeholder="optional" placeholderTextColor={C.dim} />
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
