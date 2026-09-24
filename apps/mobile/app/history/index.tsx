import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { listTests, type TestIndexRow } from '@/src/services/ledger';
import { Button, C, Note, Screen } from '@/src/ui/kit';
import { OUTCOME_TEXT, pct, when } from '@/src/ui/wording';
import { useSession } from '@/src/workflow/store';

/** S-09 History (HIS-01): newest first, read-only. */
export default function HistoryScreen() {
  const operator = useSession((st) => st.operator);
  const logout = useSession((st) => st.logout);
  const [rows, setRows] = useState<TestIndexRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      setRows(listTests());
    }, [])
  );

  const supervisor = operator?.role === 'SUPERVISOR';
  const tone = (o: string) => (o === 'PRELIMINARY_POSITIVE' ? C.red : o === 'PRELIMINARY_NEGATIVE' ? C.green : C.amber);

  return (
    <Screen
      title={supervisor ? 'Records (read-only)' : 'History'}
      back={!supervisor}
      footer={
        supervisor ? (
          <Button
            label="Sign out"
            kind="secondary"
            onPress={() => {
              logout();
              router.replace('/');
            }}
          />
        ) : undefined
      }>
      {rows.length === 0 ? <Note>No tests on this device yet.</Note> : null}
      {rows.map((r) => (
        <Pressable key={r.record_id} style={styles.row} onPress={() => router.push(`/history/${r.record_id}`)}>
          <View style={[styles.dot, { backgroundColor: tone(r.outcome) }]} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.title}>{OUTCOME_TEXT[r.outcome]?.title.replace('DEMO: ', '') ?? r.outcome}</Text>
            <Text style={styles.meta}>
              {when(r.created_at)} · {r.kit_type}
              {r.case_id ? ` · ${r.case_id}` : ''}
            </Text>
            <Text style={styles.meta}>
              seq {r.seq} · badge {r.operator_badge}
              {r.outcome !== 'INCONCLUSIVE' && r.confidence != null ? ` · confidence ${pct(r.confidence)}` : ''}
              {r.quality_score != null ? ` · quality ${r.quality_score}` : ''}
            </Text>
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: C.panel, borderColor: C.border, borderWidth: 1, borderRadius: 10, padding: 12 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  title: { color: C.text, fontSize: 15.5, fontWeight: '700' },
  meta: { color: C.muted, fontSize: 12.5 },
});
