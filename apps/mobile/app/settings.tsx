import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { S, when } from '@/src/i18n';
import { demoTiming, setDemoTiming } from '@/src/services/demo';
import { auditLedger, rebuildIndex, type AuditRow } from '@/src/services/ledger';
import { pingServer, registerDevice, registration, serverUrl, setServerUrl, type Registration } from '@/src/services/registry';
import { Button, C, Field, Note, Panel, Row, Screen } from '@/src/ui/kit';
import { useSession } from '@/src/workflow/store';

/** Device settings: agency server + key registration (SYN-01) and ledger
 * self-audit / index rebuild (EVD-09). */
export default function SettingsScreen() {
  const operator = useSession((st) => st.operator);
  const [url, setUrl] = useState(serverUrl() ?? '');
  const [reg, setReg] = useState<Registration>(registration());
  const [ping, setPing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [demo, setDemo] = useState(demoTiming());

  const save = async () => {
    setBusy('save');
    setServerUrl(url);
    const p = await pingServer(url);
    setPing(p.ok ? S.settings.reachable : S.settings.unreachable(p.detail));
    if (p.ok && operator) setReg(await registerDevice(operator.badge_id));
    else setReg(registration());
    setBusy(null);
  };

  const registerNow = async () => {
    if (!operator) return;
    setBusy('register');
    setReg(await registerDevice(operator.badge_id));
    setBusy(null);
  };

  const runAudit = async () => {
    setBusy('audit');
    const result = await auditLedger();
    const first = result.find((x) => !x.ok);
    setRows(result);
    setAuditResult(
      first
        ? { ok: false, text: S.settings.auditFailed(first.seq, S.settings.problems[first.problem!] ?? first.problem!) }
        : { ok: true, text: S.settings.auditOk(result.length, when(new Date().toISOString())) }
    );
    setBusy(null);
  };

  const rebuild = () => {
    setBusy('rebuild');
    const n = rebuildIndex();
    setRows([]);
    setAuditResult({ ok: true, text: S.settings.rebuilt(n) });
    setBusy(null);
  };

  const tone = reg.status === 'REGISTERED' ? 'good' : reg.status === 'PENDING' ? 'warn' : undefined;

  return (
    <Screen title={S.settings.title}>
      <Panel title={S.settings.server}>
        <Note>{S.settings.serverHelp}</Note>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder={S.settings.serverPlaceholder}
          placeholderTextColor={C.dim}
        />
        <Button label={S.settings.saveServer} onPress={save} busy={busy === 'save'} disabled={!url.trim()} />
        {ping ? <Note>{ping}</Note> : null}
      </Panel>

      <Panel title={S.settings.demoTitle}>
        <Note>{S.settings.demoHelp}</Note>
        <Button
          label={demo ? S.settings.demoOn : S.settings.demoOff}
          kind="secondary"
          onPress={() => {
            setDemoTiming(!demo);
            setDemo(!demo);
          }}
        />
      </Panel>

      <Panel title={S.settings.registration} tone={tone}>
        <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>{S.settings.regStatus[reg.status]}</Text>
        {reg.registered_at ? <Field label={S.settings.registeredAt} value={when(reg.registered_at)} /> : null}
        {reg.key_id ? <Field label={S.home.signingKey} value={reg.key_id} mono /> : null}
        {reg.last_error ? <Note tone="warn">{S.settings.lastError(reg.last_error)}</Note> : null}
        <Note>{S.settings.regHelp}</Note>
        {reg.status !== 'NOT_CONFIGURED' ? (
          <Button label={S.settings.registerNow} kind="secondary" onPress={registerNow} busy={busy === 'register'} />
        ) : null}
      </Panel>

      <Panel title={S.settings.ledger} tone={auditResult ? (auditResult.ok ? 'good' : 'bad') : undefined}>
        <Note>{S.settings.ledgerHelp}</Note>
        <Row>
          <Button label={S.settings.audit} kind="secondary" onPress={runAudit} busy={busy === 'audit'} />
          <Button label={S.settings.rebuild} kind="secondary" onPress={rebuild} busy={busy === 'rebuild'} />
        </Row>
        {auditResult ? <Note tone={auditResult.ok ? undefined : 'bad'}>{auditResult.text}</Note> : null}
        {rows.map((row) => {
          const first = !row.ok && rows.find((x) => !x.ok) === row;
          return (
            <View key={row.seq} style={[styles.auditRow, first && styles.firstFail]}>
              <Text style={[styles.mark, { color: row.ok ? C.green : C.red }]}>{row.ok ? S.settings.auditPass : '✗'}</Text>
              <Text style={styles.auditText}>
                {S.settings.auditRow(row.seq, row.record_type, row.record_id.slice(0, 8))}
                {row.ok ? '' : ` — ${S.settings.problems[row.problem!] ?? row.problem}`}
                {first ? ` — ${S.settings.firstFailure}` : ''}
              </Text>
            </View>
          );
        })}
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  auditRow: { flexDirection: 'row', gap: 8, paddingVertical: 3, paddingHorizontal: 4, borderRadius: 4 },
  firstFail: { backgroundColor: '#3a1414' },
  mark: { width: 26, fontWeight: '800', fontSize: 12.5 },
  auditText: { color: C.muted, fontSize: 12.5, fontFamily: 'monospace', flex: 1 },
  input: { backgroundColor: C.bg, borderColor: C.border, borderWidth: 1, borderRadius: 8, color: C.text, fontSize: 16, paddingHorizontal: 12, paddingVertical: 10 },
});
