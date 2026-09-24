import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';

import { S } from '@/src/i18n';
import { DEMO_OPERATORS, login } from '@/src/services/auth';
import { Button, C, Note, Panel, Screen } from '@/src/ui/kit';
import { useSession } from '@/src/workflow/store';

/** S-01 Login (AUTH-01, AUTH-02). */
export default function LoginScreen() {
  const [badge, setBadge] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setOperator = useSession((st) => st.login);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const op = await login(badge, pin);
      setOperator(op);
      setPin('');
      // AUTH-02: officers go to Home; supervisors to the record list (review is P2).
      router.replace(op.role === 'SUPERVISOR' ? '/history' : '/home');
    } catch {
      setError(S.login.wrong);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={S.login.title} back={false}>
      <Text style={styles.heading}>{S.app.tagline}</Text>
      <Note>{S.app.presumptive}</Note>

      <Panel>
        <Text style={styles.label}>{S.login.badge}</Text>
        <TextInput
          style={styles.input}
          value={badge}
          onChangeText={setBadge}
          keyboardType="number-pad"
          autoCorrect={false}
          placeholder={S.login.badgePlaceholder}
          placeholderTextColor={C.dim}
        />
        <Text style={styles.label}>{S.login.pin}</Text>
        <TextInput
          style={styles.input}
          value={pin}
          onChangeText={setPin}
          keyboardType="number-pad"
          secureTextEntry
          placeholder="••••"
          placeholderTextColor={C.dim}
          onSubmitEditing={submit}
        />
        {error ? <Note tone="bad">{error}</Note> : null}
        <Button label={S.login.signIn} onPress={submit} busy={busy} disabled={!badge || !pin} />
      </Panel>

      <Panel title={S.login.demoAccounts}>
        {DEMO_OPERATORS.map((o) => (
          <Text key={o.badge_id} style={styles.demo}>
            {S.login.demoLine(o.badge_id, o.pin, o.name, S.role[o.role])}
          </Text>
        ))}
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { color: C.text, fontSize: 24, fontWeight: '800' },
  label: { color: C.muted, fontSize: 13 },
  input: { backgroundColor: '#0f1219', borderColor: C.border, borderWidth: 1, borderRadius: 8, color: C.text, fontSize: 18, paddingHorizontal: 12, paddingVertical: 10 },
  demo: { color: C.muted, fontSize: 14, fontFamily: 'monospace' },
});
