import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';

import { getDeviceIdentity } from '@/src/adapters/keystore';
import { S } from '@/src/i18n';
import { auditChain, ledgerLength, listTests } from '@/src/services/ledger';
import { loadRefdb } from '@/src/services/refdb';
import { ensureRegistered, registration, type Registration } from '@/src/services/registry';
import { Button, C, Field, Note, Panel, Screen } from '@/src/ui/kit';
import { useSession } from '@/src/workflow/store';

/** S-02 Home (HOME-01). */
export default function HomeScreen() {
  const operator = useSession((st) => st.operator);
  const logout = useSession((st) => st.logout);
  const [keyId, setKeyId] = useState('…');
  const [chain, setChain] = useState<{ ok: boolean | null; detail: string }>({ ok: null, detail: S.home.chainChecking });
  const [counts, setCounts] = useState({ records: 0, tests: 0 });
  const [reg, setReg] = useState<Registration>(registration());

  // SYN-01: each time Home is shown, try any pending registration (offline-safe).
  useFocusEffect(
    useCallback(() => {
      if (!operator) return;
      setReg(registration());
      setCounts({ records: ledgerLength(), tests: listTests().length });
      ensureRegistered(operator.badge_id).then(setReg);
    }, [operator])
  );

  useEffect(() => {
    if (!operator) {
      router.replace('/');
      return;
    }
    getDeviceIdentity().then((i) => setKeyId(i.keyId));
    setCounts({ records: ledgerLength(), tests: listTests().length });
    auditChain().then((r) =>
      setChain(r.ok ? { ok: true, detail: S.home.chainIntact } : { ok: false, detail: S.home.brokenAt(r.failure.seq, r.failure.reason) })
    );
  }, [operator]);

  if (!operator) return null;
  const refdb = loadRefdb();

  return (
    <Screen title={S.home.title} back={false}>
      <Panel>
        <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>{operator.name}</Text>
        <Note>{S.home.badgeLine(operator.badge_id, S.role[operator.role])}</Note>
      </Panel>

      {chain.ok === false ? (
        <Panel tone="bad" title={S.home.integrityAlert}>
          <Note tone="bad">{S.home.chainBroken(chain.detail)}</Note>
        </Panel>
      ) : null}

      <Button label={S.home.startTest} onPress={() => router.push('/test/kit')} />
      <Button label={S.home.history} kind="secondary" onPress={() => router.push('/history')} />

      <Panel title={S.home.thisDevice}>
        <Field label={S.home.signingKey} value={keyId} mono />
        <Field label={S.home.ledger} value={S.home.ledgerLine(counts.records, counts.tests, chain.ok === false ? S.home.chainBrokenShort : chain.detail)} />
        <Field label={S.home.refdb} value={`${refdb.version} · ${refdb.sha256.slice(0, 16)}…`} mono />
        <Field label={S.home.registration} value={S.home.regShort[reg.status]} />
        <Button label={S.home.settings} kind="ghost" onPress={() => router.push('/settings')} />
      </Panel>

      <Panel title={S.home.developer}>
        <Button label={S.home.spike} kind="ghost" onPress={() => router.push('/spike')} />
        <Button label={S.home.smoke} kind="ghost" onPress={() => router.push('/smoke')} />
      </Panel>

      <Button
        label={S.common.signOut}
        kind="ghost"
        onPress={() => {
          logout();
          router.replace('/');
        }}
      />
    </Screen>
  );
}
