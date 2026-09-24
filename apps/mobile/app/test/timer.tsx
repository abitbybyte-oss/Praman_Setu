import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { S } from '@/src/i18n';
import { demoTiming } from '@/src/services/demo';
import { kit } from '@/src/services/refdb';
import { Button, C, Note, Panel, Screen } from '@/src/ui/kit';
import { useSession } from '@/src/workflow/store';
import { mmss, startTimer, windowState } from '@/src/workflow/timer';

/** S-04 Reaction timer (TMR-01, TMR-02): the kit protocol checklist, then
 * START TIMER. The interval comes from the signed Reference DB and cannot be
 * edited here. */
export default function TimerScreen() {
  const draft = useSession((st) => st.draft);
  const setTimer = useSession((st) => st.setTimer);
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  if (!draft) {
    return (
      <Screen title={S.timer.title}>
        <Note>{S.common.noTest}</Note>
      </Screen>
    );
  }

  const profile = kit(draft.kitType);
  const demo = demoTiming();
  const t = draft.timer;
  const w = t ? windowState(t) : null;
  const required = t?.required_s ?? (demo ? profile.protocol.demo_required_s : profile.protocol.required_s);

  return (
    <Screen
      title={S.timer.title}
      footer={
        t ? (
          <Button label={S.timer.toCamera} onPress={() => router.push('/test/capture')} />
        ) : (
          <Button label={S.timer.start} onPress={() => setTimer(startTimer(profile.protocol, demo))} />
        )
      }>
      <Panel title={S.timer.protocol}>
        <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>{profile.display_name}</Text>
        {profile.protocol.steps.map((step, i) => (
          <Note key={step}>
            {i + 1}. {step}
          </Note>
        ))}
        <Note>{S.timer.interval(required, profile.protocol.max_s)}</Note>
        {demo ? <Note tone="warn">{S.timer.demo}</Note> : null}
      </Panel>

      {t && w ? (
        <Panel tone={w.state === 'OPEN' ? 'good' : w.state === 'LATE' ? 'bad' : 'warn'}>
          <Text style={{ color: C.text, fontSize: 40, fontWeight: '800', textAlign: 'center' }}>
            {w.state === 'WAITING' ? mmss(w.remaining_s) : mmss(w.elapsed_s)}
          </Text>
          <Note>{w.state === 'WAITING' ? S.timer.started : w.state === 'OPEN' ? S.capture.open : S.capture.late}</Note>
        </Panel>
      ) : null}
    </Screen>
  );
}
