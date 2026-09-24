import { useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';

import { S, when } from '@/src/i18n';
import { auditChain, ledgerLength, rebuildIndex } from '@/src/services/ledger';
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
    const r = await auditChain();
    setAuditResult(
      r.ok
        ? { ok: true, text: S.settings.auditOk(ledgerLength(), when(new Date().toISOString())) }
        : { ok: false, text: S.settings.auditFailed(r.failure.seq, r.failure.reason) }
    );
    setBusy(null);
  };

  const rebuild = () => {
    setBusy('rebuild');
    const n = rebuildIndex();
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
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: C.bg, borderColor: C.border, borderWidth: 1, borderRadius: 8, color: C.text, fontSize: 16, paddingHorizontal: 12, paddingVertical: 10 },
});
