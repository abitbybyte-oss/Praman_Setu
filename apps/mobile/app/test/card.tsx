import { Circle, Path, Skia } from '@shopify/react-native-skia';
import { CORNER_ORDER, type CornerId, type Point } from '@fdtc/color-core';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Text, useWindowDimensions } from 'react-native';

import { workingCopy, type WorkingCopy } from '@/src/services/image';
import { label, S } from '@/src/i18n';
import { calibrateCard, snapCorner } from '@/src/services/measure';
import { ImageTapper } from '@/src/ui/ImageTapper';
import { Button, C, Note, Panel, Row, Screen } from '@/src/ui/kit';
import { currentCapture, useSession } from '@/src/workflow/store';

/** S-06 Card calibration (CAL-01..05). The officer taps the four corner dots
 * of the printed card; the patches are located by homography, sampled,
 * colour-corrected and checked. */

export default function CardScreen() {
  const draft = useSession((st) => st.draft);
  const setCard = useSession((st) => st.setCard);
  const clearCard = useSession((st) => st.clearCard);
  const rejectCurrent = useSession((st) => st.rejectCurrent);
  const endEarly = useSession((st) => st.endEarly);
  const { height } = useWindowDimensions();
  const cap = currentCapture(draft);
  const [wc, setWc] = useState<WorkingCopy | null>(null);
  const [taps, setTaps] = useState<{ p: Point; snapped: boolean }[]>(() =>
    draft?.corners ? CORNER_ORDER.map((c, i) => ({ p: draft.corners![c], snapped: draft.cornersSnapped[i] ?? false })) : []
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cap) workingCopy(cap.uri).then(setWc, (e) => setError(String(e)));
  }, [cap]);

  const card = draft?.card ?? null;
  const cal = card?.calibration ?? null;

  const outlines = useMemo(() => {
    if (!card) return [];
    return card.sampling.patches.map((p) => ({ id: p.id, pts: p.outline, ok: card.sampling.samples[p.id]?.ok ?? false }));
  }, [card]);

  if (!draft || !cap) {
    return (
      <Screen title={S.card.title}>
        <Note>{S.card.noPhoto}</Note>
      </Screen>
    );
  }

  const onTap = (raw: Point) => {
    if (taps.length >= 4 || !wc) return;
    const s = snapCorner(wc.img, raw);
    const next = [...taps, { p: s.point, snapped: s.snapped }];
    setTaps(next);
    if (next.length === 4) {
      const corners = Object.fromEntries(CORNER_ORDER.map((c, i) => [c, next[i].p])) as Record<CornerId, Point>;
      try {
        setCard(corners, next.map((t) => t.snapped), calibrateCard(wc.img, corners));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  const undo = () => {
    setTaps(taps.slice(0, -1));
    clearCard();
  };

  const retake = () => {
    rejectCurrent(cal?.card_status === 'INVALID' ? 'CARD_CALIBRATION_FAILED' : 'RETAKEN');
    router.back();
  };

  const endInvalid = () => {
    endEarly({ kind: 'CARD_INVALID', reasons: ['CARD_CALIBRATION_FAILED'] });
    router.push('/test/result');
  };

  const overlay = (k: number) => (
    <>
      {outlines.map((o) => {
        const path = Skia.Path.Make();
        path.moveTo(o.pts[0][0] * k, o.pts[0][1] * k);
        for (const q of o.pts.slice(1)) path.lineTo(q[0] * k, q[1] * k);
        path.close();
        return <Path key={o.id} path={path} style="stroke" strokeWidth={2} color={o.ok ? '#3fbf7f' : '#e05252'} />;
      })}
      {taps.map((t, i) => (
        <Circle key={i} cx={t.p[0] * k} cy={t.p[1] * k} r={7} style="stroke" strokeWidth={2.5} color={t.snapped ? '#3fbf7f' : '#e0a33a'} />
      ))}
    </>
  );

  const prompt = taps.length < 4 ? S.card.tapPrompt(S.card.corners[CORNER_ORDER[taps.length]]) : null;
  const valid = cal?.card_status === 'VALID';

  return (
    <Screen
      title={S.card.title}
      footer={
        <>
          <Row>
            <Button label={S.card.undo} kind="secondary" onPress={undo} disabled={taps.length === 0} />
            <Button label={S.card.retake} kind="secondary" onPress={retake} />
          </Row>
          {cal && !valid ? <Button label={S.card.endInconclusive} kind="danger" onPress={endInvalid} /> : null}
          <Button label={S.card.continue} onPress={() => router.push('/test/roi')} disabled={!valid} />
        </>
      }>
      {prompt ? <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>{prompt}</Text> : null}
      {wc ? <ImageTapper wc={wc} onTap={onTap} overlay={overlay} maxHeight={height * 0.5} /> : <Note>{S.common.loadingPhoto}</Note>}
      {taps.some((t) => !t.snapped) ? <Note tone="warn">{S.card.notSnapped}</Note> : null}

      {card && !card.sampling.corners.ok ? (
        <Panel tone="bad" title={S.card.cornersRejected}>
          {card.sampling.corners.problems.map((p) => (
            <Note key={p} tone="bad">• {label(S.card.cornerProblems, p)}</Note>
          ))}
        </Panel>
      ) : null}

      {cal ? (
        <Panel tone={valid ? 'good' : 'bad'} title={valid ? S.card.valid : S.card.invalid}>
          {valid ? (
            <Note>
              {S.card.fitted(cal.residual_de00_mean.toFixed(2), cal.residual_de00_max.toFixed(2))}
            </Note>
          ) : (
            cal.failed_checks.map((c) => (
              <Note key={c} tone="bad">• {label(S.card.checks, c)}</Note>
            ))
          )}
        </Panel>
      ) : null}
      {error ? <Note tone="bad">{error}</Note> : null}
    </Screen>
  );
}
