import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { S } from '@/src/i18n';
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
    <Screen title={S.kit.title} footer={<Button label={S.kit.continue} onPress={start} disabled={!kitType} />}>
      <Panel title={S.kit.kitType}>
        {kits().map(([type, k]) => (
          <Pressable key={type} onPress={() => setKitType(type)} style={[styles.kit, kitType === type && styles.selected]}>
            <Text style={styles.kitName}>{k.display_name}</Text>
            <Text style={styles.kitMeta}>
              {S.kit.kitMeta(type, k.protocol.required_s, k.protocol.max_s)}
            </Text>
          </Pressable>
        ))}
        <Note>{S.kit.manualNote}</Note>
      </Panel>

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
