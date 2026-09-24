import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { label, pct, S, when } from '@/src/i18n';
import { activeFilterCount, type HistoryFilters } from '@/src/services/historyQuery';
import { localDate } from '@/src/services/kitqr';
import { listTests, type TestIndexRow } from '@/src/services/ledger';
import { kits } from '@/src/services/refdb';
import { Button, C, Note, Panel, Screen } from '@/src/ui/kit';
import { useSession } from '@/src/workflow/store';

/** S-09 History (HIS-01, HIS-03): newest first — short test ID, outcome,
 * time, kit, sync badge — with filters on date, officer, outcome, kit type
 * and case number. Read-only. */

const OUTCOMES = ['PRELIMINARY_POSITIVE', 'PRELIMINARY_NEGATIVE', 'INCONCLUSIVE'] as const;
const daysAgo = (n: number) => localDate(new Date(Date.now() - n * 86_400_000));

export default function HistoryScreen() {
  const operator = useSession((st) => st.operator);
  const logout = useSession((st) => st.logout);
  const [filters, setFilters] = useState<HistoryFilters>({});
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<TestIndexRow[]>([]);
  const [ms, setMs] = useState(0);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

  const load = useCallback((f: HistoryFilters) => {
    const t = performance.now();
    setRows(listTests(f));
    setMs(Math.round(performance.now() - t));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(filters);
    }, [load, filters])
  );

  const update = (patch: Partial<HistoryFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const supervisor = operator?.role === 'SUPERVISOR';
  const tone = (o: string) => (o === 'PRELIMINARY_POSITIVE' ? C.red : o === 'PRELIMINARY_NEGATIVE' ? C.green : C.amber);
  const n = activeFilterCount(filters);
  const range = !filters.from && !filters.to ? 'all' : filters.to === localDate() && filters.from === localDate() ? 'today' : filters.from === daysAgo(6) ? '7' : filters.from === daysAgo(29) ? '30' : 'custom';

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
      <Button label={n ? S.history.filtersActive(n) : S.history.filters} kind="secondary" onPress={() => setOpen(!open)} />
      {open ? (
        <Panel>
          <Text style={styles.label}>{S.history.date}</Text>
          <View style={styles.pills}>
            <Pill text={S.history.today} on={range === 'today'} onPress={() => { update({ from: localDate(), to: localDate() }); setFromText(localDate()); setToText(localDate()); }} />
            <Pill text={S.history.last7} on={range === '7'} onPress={() => { update({ from: daysAgo(6), to: null }); setFromText(daysAgo(6)); setToText(''); }} />
            <Pill text={S.history.last30} on={range === '30'} onPress={() => { update({ from: daysAgo(29), to: null }); setFromText(daysAgo(29)); setToText(''); }} />
            <Pill text={S.history.all} on={range === 'all'} onPress={() => { update({ from: null, to: null }); setFromText(''); setToText(''); }} />
          </View>
          <View style={styles.pair}>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder={S.history.from} placeholderTextColor={C.dim} value={fromText} onChangeText={(v) => { setFromText(v); if (!v || isDate(v)) update({ from: v || null }); }} />
            <TextInput style={[styles.input, { flex: 1 }]} placeholder={S.history.to} placeholderTextColor={C.dim} value={toText} onChangeText={(v) => { setToText(v); if (!v || isDate(v)) update({ to: v || null }); }} />
          </View>

          <Text style={styles.label}>{S.history.outcome}</Text>
          <View style={styles.pills}>
            {OUTCOMES.map((o) => (
              <Pill key={o} text={S.outcome[o].short} on={filters.outcome === o} onPress={() => update({ outcome: filters.outcome === o ? null : o })} />
            ))}
          </View>

          <Text style={styles.label}>{S.history.kit}</Text>
          <View style={styles.pills}>
            {kits().map(([type]) => (
              <Pill key={type} text={type} on={filters.kitType === type} onPress={() => update({ kitType: filters.kitType === type ? null : type })} />
            ))}
          </View>

          <View style={styles.pair}>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder={S.history.officer} placeholderTextColor={C.dim} keyboardType="number-pad" value={filters.officer ?? ''} onChangeText={(v) => update({ officer: v || null })} />
            <TextInput style={[styles.input, { flex: 1 }]} placeholder={S.history.caseNo} placeholderTextColor={C.dim} autoCapitalize="characters" value={filters.caseId ?? ''} onChangeText={(v) => update({ caseId: v || null })} />
          </View>
          <View style={styles.pills}>
            <Pill text={S.history.hideVoided} on={filters.includeVoided === false} onPress={() => update({ includeVoided: filters.includeVoided === false ? undefined : false })} />
          </View>
          {n ? <Button label={S.history.clear} kind="ghost" onPress={() => { setFilters({}); setFromText(''); setToText(''); }} /> : null}
        </Panel>
      ) : null}

      <Note>{S.history.count(rows.length, ms)}</Note>
      {rows.length === 0 && n === 0 ? <Note>{S.history.empty}</Note> : null}
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

function Pill({ text, on, onPress }: { text: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, on && styles.pillOn]}>
      <Text style={[styles.pillText, on && { color: '#fff' }]}>{text}</Text>
    </Pressable>
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
  label: { color: C.muted, fontSize: 12.5, fontWeight: '700' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  pillOn: { backgroundColor: C.blue, borderColor: C.blue },
  pillText: { color: C.muted, fontSize: 13, fontWeight: '600' },
  pair: { flexDirection: 'row', gap: 8 },
  input: { backgroundColor: C.bg, borderColor: C.border, borderWidth: 1, borderRadius: 8, color: C.text, fontSize: 14, paddingHorizontal: 10, paddingVertical: 8 },
});
