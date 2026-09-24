import { Circle } from '@shopify/react-native-skia';
import type { Point } from '@fdtc/color-core';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, useWindowDimensions } from 'react-native';

import { workingCopy, type WorkingCopy } from '@/src/services/image';
import { defaultRoiRadius, measureSample, type SampleResult } from '@/src/services/measure';
import { ImageTapper } from '@/src/ui/ImageTapper';
import { Button, C, Note, Panel, Row, Screen } from '@/src/ui/kit';
import { currentCapture, guards, useSession } from '@/src/workflow/store';

/** S-07 Sample region (ROI-01/02): tap the centre of the reaction area and
 * adjust the radius. Measurement uses the corrected median colour. */
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
    if (cap)
      workingCopy(cap.uri).then((w) => {
        setWc(w);
        setRadius((r) => r || defaultRoiRadius(w.img));
      }, (e) => setError(String(e)));
  }, [cap]);

  if (!draft || !cap || !guards.cardValid(draft)) {
    return (
      <Screen title="Sample">
        <Note>The card must be calibrated (CARD VALID) first.</Note>
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

  const minR = wc ? Math.round(Math.max(wc.img.width, wc.img.height) * 0.008) : 4;
  const maxR = wc ? Math.round(Math.max(wc.img.width, wc.img.height) * 0.15) : 200;

  return (
    <Screen
      title="Mark the reaction area"
      footer={
        glare ? (
          <Row>
            <Button
              label="Retake photo"
              kind="secondary"
              onPress={() => {
                rejectCurrent('EXCESSIVE_GLARE');
                router.dismissTo('/test/capture');
              }}
            />
            <Button
              label="End test"
              kind="danger"
              onPress={() => {
                endEarly({ kind: 'HARD_GATE', reasons: ['EXCESSIVE_GLARE'] });
                router.push('/test/result');
              }}
            />
          </Row>
        ) : (
          <Button label="Measure" onPress={measure} disabled={!centre} />
        )
      }>
      <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>
        {centre ? 'Adjust the circle to cover only the reaction colour' : 'Tap the centre of the reaction area'}
      </Text>
      {wc ? (
        <ImageTapper
          wc={wc}
          maxHeight={height * 0.5}
          onTap={(p) => {
            setCentre(p);
            setGlare(null);
          }}
          overlay={(k) =>
            centre ? <Circle cx={centre[0] * k} cy={centre[1] * k} r={radius * k} style="stroke" strokeWidth={2.5} color="#e0a33a" /> : null
          }
        />
      ) : (
        <Note>Loading photo…</Note>
      )}
      <Row>
        <Button label="− Smaller" kind="secondary" onPress={() => setRadius((r) => Math.max(minR, Math.round(r / 1.25)))} />
        <Button label="+ Larger" kind="secondary" onPress={() => setRadius((r) => Math.min(maxR, Math.round(r * 1.25)))} />
      </Row>
      <Note>Radius {radius} px. Keep the circle inside the coloured area, away from edges and reflections.</Note>

      {glare ? (
        <Panel tone="bad" title="Strong glare in the reaction area">
          <Note tone="bad">
            {Math.round(glare.glare.glare_fraction * 1000) / 10}% of the area is a reflection. Tilt the kit or move the light, then retake.
          </Note>
        </Panel>
      ) : null}
      {error ? <Note tone="bad">{error}</Note> : null}
    </Screen>
  );
}
