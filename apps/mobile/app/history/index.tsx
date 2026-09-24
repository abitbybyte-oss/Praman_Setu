import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { label, pct, S, when } from '@/src/i18n';
import { listTests, type TestIndexRow } from '@/src/services/ledger';
import { Button, C, Note, Screen } from '@/src/ui/kit';
import { useSession } from '@/src/workflow/store';

/** S-09 History (HIS-01): newest first — short test ID, outcome, time, kit,
 * sync badge. Read-only. */
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
      title={supervisor ? S.history.titleSupervisor : S.history.title}
      back={!supervisor}
      footer={
        supervisor ? (
          <Button
            label={S.common.signOut}
            kind="secondary"
            onPress={() => {
              logout();
              router.replace('/');
            }}
          />
        ) : undefined
      }>
      {rows.length === 0 ? <Note>{S.history.empty}</Note> : null}
      {rows.map((r) => (
        <Pressable key={r.record_id} style={styles.row} onPress={() => router.push(`/history/${r.record_id}`)}>
          <View style={[styles.dot, { backgroundColor: tone(r.outcome) }]} />
          <View style={{ flex: 1, gap: 2 }}>
            <View style={styles.top}>
              <Text style={styles.id}>{r.record_id.slice(0, 8).toUpperCase()}</Text>
              <View style={styles.badges}>
                {r.voided ? <Text style={[styles.sync, styles.voided]}>{S.history.voided}</Text> : null}
                <Text style={[styles.sync, r.sync_status === 'SYNCED' ? styles.synced : styles.pending]}>{label(S.history.sync, r.sync_status)}</Text>
              </View>
            </View>
            <Text style={[styles.title, r.voided ? styles.struck : null]}>{S.outcome[r.outcome]?.short ?? r.outcome}</Text>
            <Text style={styles.meta}>{S.history.meta1(when(r.created_at), r.kit_type, r.case_id)}</Text>
            <Text style={styles.meta}>
              {S.history.meta2(r.seq, r.operator_badge)}
              {r.outcome !== 'INCONCLUSIVE' && r.confidence != null ? S.history.confidence(pct(r.confidence)) : ''}
              {r.quality_score != null ? S.history.quality(r.quality_score) : ''}
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
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  id: { color: C.muted, fontFamily: 'monospace', fontSize: 12.5 },
  sync: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.5, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  pending: { color: '#1b1300', backgroundColor: C.amber },
  synced: { color: '#00170b', backgroundColor: C.green },
  voided: { color: '#fff', backgroundColor: '#8a2a2a' },
  badges: { flexDirection: 'row', gap: 6 },
  struck: { textDecorationLine: 'line-through', color: C.muted },
  title: { color: C.text, fontSize: 15.5, fontWeight: '700' },
  meta: { color: C.muted, fontSize: 12.5 },
});
