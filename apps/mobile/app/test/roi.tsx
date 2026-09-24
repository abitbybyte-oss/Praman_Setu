import { Circle } from '@shopify/react-native-skia';
import type { Point } from '@fdtc/color-core';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Text, useWindowDimensions } from 'react-native';

import { pct, S } from '@/src/i18n';
import { correctedView, workingCopy, type WorkingCopy } from '@/src/services/image';
import { defaultRoiRadius, measureSample, type SampleResult } from '@/src/services/measure';
import { ImageTapper } from '@/src/ui/ImageTapper';
import { Button, C, Note, Panel, Row, Screen } from '@/src/ui/kit';
import { Slider } from '@/src/ui/Slider';
import { currentCapture, guards, useSession } from '@/src/workflow/store';

/** S-07 Sample region (ROI-01, ROI-02, ROI-04). Shows the colour-corrected
 * image; the officer taps the centre of the colour change and sets the radius
 * with a slider. Measurement uses the corrected median colour. */
export default function RoiScreen() {
  const draft = useSession((st) => st.draft);
  const setSample = useSession((st) => st.setSample);
  const rejectCurrent = useSession((st) => st.rejectCurrent);
  const endEarly = useSession((st) => st.endEarly);
  const { height } = useWindowDimensions();
  const cap = currentCapture(draft);
  const [wc, setWc] = useState<WorkingCopy | null>(null);
  const [centre, setCentre] = useState<Point | null>(draft?.roi ? [draft.roi.x, draft.roi.y] : null);
  const [radius, setRadius] = useState<number>(draft?.roi?.r ?? 0);
  const [glare, setGlare] = useState<SampleResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cap) return;
    workingCopy(cap.uri).then(
      (w) => {
        setWc(w);
        setRadius((r) => r || defaultRoiRadius(w.img));
      },
      (e) => setError(String(e))
    );
  }, [cap]);

  const matrix = draft?.card?.calibration.matrix;
  const view = useMemo(() => (wc && matrix?.length ? correctedView(wc, matrix) : wc), [wc, matrix]);

  if (!draft || !cap || !guards.cardValid(draft)) {
    return (
      <Screen title={S.roi.title}>
        <Note>{S.roi.needCard}</Note>
      </Screen>
    );
  }

  const measure = () => {
    if (!wc || !centre) return;
    setError(null);
    try {
      const circle = { x: centre[0], y: centre[1], r: radius };
      const result = measureSample(wc.img, circle, draft.card!, draft.kitType);
      setSample(circle, result);
      if (result.glareHardGate) setGlare(result);
      else router.push('/test/result');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const longSide = wc ? Math.max(wc.img.width, wc.img.height) : 1600;
  const minR = Math.round(longSide * 0.008);
  const maxR = Math.round(longSide * 0.12);

  return (
    <Screen
      title={S.roi.title}
      footer={
        glare ? (
          <Row>
            <Button
              label={S.roi.retake}
              kind="secondary"
              onPress={() => {
                rejectCurrent('EXCESSIVE_GLARE');
                router.dismissTo('/test/capture');
              }}
            />
            <Button
              label={S.roi.endTest}
              kind="danger"
              onPress={() => {
                endEarly({ kind: 'HARD_GATE', reasons: ['EXCESSIVE_GLARE'] });
                router.push('/test/result');
              }}
            />
          </Row>
        ) : (
          <Button label={S.roi.measure} onPress={measure} disabled={!centre} />
        )
      }>
      <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>{centre ? S.roi.adjustPrompt : S.roi.tapPrompt}</Text>
      {view ? (
        <>
          <ImageTapper
            wc={view}
            maxHeight={height * 0.5}
            onTap={(p) => {
              setCentre(p);
              setGlare(null);
            }}
            overlay={(k) =>
              centre ? <Circle cx={centre[0] * k} cy={centre[1] * k} r={radius * k} style="stroke" strokeWidth={2.5} color="#e0a33a" /> : null
            }
          />
          <Note>{S.roi.corrected}</Note>
        </>
      ) : (
        <Note>{S.common.loadingPhoto}</Note>
      )}
      <Slider value={radius} min={minR} max={maxR} onChange={(r) => { setRadius(r); setGlare(null); }} />
      <Note>{S.roi.radius(radius)}</Note>

      {glare ? (
        <Panel tone="bad" title={S.roi.glareTitle}>
          <Note tone="bad">{S.roi.glareBody(pct(glare.glare.glare_fraction))}</Note>
        </Panel>
      ) : null}
      {error ? <Note tone="bad">{error}</Note> : null}
    </Screen>
  );
}
