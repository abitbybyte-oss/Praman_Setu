import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { getDeviceIdentity } from '@/src/adapters/keystore';
import { auditChain, ledgerLength, listTests } from '@/src/services/ledger';
import { loadRefdb } from '@/src/services/refdb';
import { Button, C, Field, Note, Panel, Screen } from '@/src/ui/kit';
import { useSession } from '@/src/workflow/store';

/** S-02 Home (HOME-01). */
export default function HomeScreen() {
  const operator = useSession((st) => st.operator);
  const logout = useSession((st) => st.logout);
  const [keyId, setKeyId] = useState('…');
  const [chain, setChain] = useState<string>('checking…');
  const [counts, setCounts] = useState({ records: 0, tests: 0 });

  useEffect(() => {
    if (!operator) {
      router.replace('/');
      return;
    }
    getDeviceIdentity().then((i) => setKeyId(i.keyId));
    setCounts({ records: ledgerLength(), tests: listTests().length });
    auditChain().then((r) => setChain(r.ok ? 'intact' : `BROKEN at seq ${r.failure.seq} (${r.failure.reason})`));
  }, [operator]);

  if (!operator) return null;
  const refdb = loadRefdb();

  return (
    <Screen title="Home" back={false}>
      <Panel>
        <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>{operator.name}</Text>
        <Note>Badge {operator.badge_id} · {operator.role.toLowerCase()}</Note>
      </Panel>

      {chain.startsWith('BROKEN') ? (
        <Panel tone="bad" title="Integrity alert">
          <Note tone="bad">Device ledger chain is {chain}. Nothing is auto-repaired. Supervisor attention required.</Note>
        </Panel>
      ) : null}

      <Button label="Start new test" onPress={() => router.push('/test/kit')} />
      <Button label="View history" kind="secondary" onPress={() => router.push('/history')} />

      <Panel title="This device">
        <Field label="Signing key" value={keyId} mono />
        <Field label="Ledger" value={`${counts.records} records · ${counts.tests} tests · chain ${chain}`} />
        <Field label="Reference DB" value={`${refdb.version} · ${refdb.sha256.slice(0, 16)}…`} mono />
      </Panel>

      <Panel title="Developer">
        <Button label="Phase 0 evidence spike" kind="ghost" onPress={() => router.push('/spike')} />
        <Button label="Native smoke test" kind="ghost" onPress={() => router.push('/smoke')} />
      </Panel>

      <Button
        label="Sign out"
        kind="ghost"
        onPress={() => {
          logout();
          router.replace('/');
        }}
      />
    </Screen>
  );
}
