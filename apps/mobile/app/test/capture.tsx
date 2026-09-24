import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';

import { S } from '@/src/i18n';
import { startLocationFix } from '@/src/services/context';
import { storeCapture } from '@/src/services/evidence';
import { workingCopy } from '@/src/services/image';
import { blurCheck } from '@/src/services/measure';
import { Button, C, Note, Panel, Row, Screen } from '@/src/ui/kit';
import { useSession } from '@/src/workflow/store';

/** S-05 Guided capture (CAP-01 guides, CAP-02 write-once + hash, CAP-03 blur gate).
 * Every capture — accepted or rejected — is kept and listed in the record. */
export default function CaptureScreen() {
  const draft = useSession((st) => st.draft);
  const addCapture = useSession((st) => st.addCapture);
  const endEarly = useSession((st) => st.endEarly);
  const clearDraft = useSession((st) => st.clearDraft);
  const { hasPermission, requestPermission } = useCameraPermission();
  const photoOutput = usePhotoOutput({ containerFormat: 'jpeg', quality: 0.95 });
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [blurry, setBlurry] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPermission) requestPermission();
    startLocationFix();
  }, [hasPermission, requestPermission]);

  // Release the camera whenever this screen is not in front.
  useFocusEffect(
    useCallback(() => {
      setActive(true);
      return () => setActive(false);
    }, [])
  );

  if (!draft) {
    return (
      <Screen title={S.capture.capture}>
        <Note>{S.common.noTest}</Note>
        <Button label={S.common.home} onPress={() => router.replace('/home')} />
      </Screen>
    );
  }

  const take = async () => {
    setError(null);
    setBlurry(null);
    setBusy(S.capture.capturing);
    try {
      const photo = await photoOutput.capturePhotoToFile({}, {});
      const takenAt = new Date().toISOString();
      setBusy(S.capture.hashing);
      const stored = await storeCapture(photo.filePath, draft.recordId, draft.captures.length + 1);
      setBusy(S.capture.checkingSharpness);
      const wc = await workingCopy(stored.uri);
      const blur = blurCheck(wc.img);
      addCapture({
        uri: stored.uri,
        sha256: stored.sha256,
        bytes: stored.bytes,
        taken_at: takenAt,
        accepted: !blur.blurry,
        reject_reasons: blur.blurry ? ['IMAGE_BLURRY'] : [],
        laplacian_variance: blur.laplacian_variance,
      });
      if (blur.blurry) setBlurry(blur.laplacian_variance);
      else router.push('/test/card');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const endTest = () => {
    if (draft.captures.length === 0) {
      clearDraft();
      router.replace('/home');
      return;
    }
    // Captures exist, so the test must still produce a record accounting for them.
    endEarly(blurry !== null ? { kind: 'HARD_GATE', reasons: ['IMAGE_BLURRY'] } : { kind: 'ABANDONED', reasons: ['ABANDONED'] });
    router.push('/test/result');
  };

  return (
    <Screen
      title={S.capture.title(draft.kitType)}
      scroll={false}
      footer={
        <Row>
          <Button label={draft.captures.length ? S.capture.endTest : S.capture.cancel} kind="secondary" onPress={endTest} disabled={!!busy} />
          <Button label={busy ?? (draft.captures.length ? S.capture.retake : S.capture.capture)} onPress={take} busy={!!busy} disabled={!hasPermission} />
        </Row>
      }>
      <View style={styles.preview}>
        {hasPermission ? (
          <Camera style={StyleSheet.absoluteFill} device="back" isActive={active} outputs={[photoOutput]} />
        ) : (
          <Text style={styles.permission}>{S.capture.permission}</Text>
        )}
        {/* CAP-01: framing guides only; correctness comes from the in-frame card. */}
        <View pointerEvents="none" style={[styles.guide, styles.cardGuide]}>
          <Text style={styles.guideText}>{S.capture.guideCard}</Text>
        </View>
        <View pointerEvents="none" style={[styles.guide, styles.kitGuide]}>
          <Text style={styles.guideText}>{S.capture.guideKit}</Text>
        </View>
      </View>

      {blurry !== null ? (
        <Panel tone="bad" title={S.capture.blurryTitle}>
          <Note tone="bad">{S.capture.blurryBody(Math.round(blurry))}</Note>
        </Panel>
      ) : (
        <Note>{S.capture.hint(draft.captures.length)}</Note>
      )}
      {error ? <Note tone="bad">{error}</Note> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { flex: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000', minHeight: 320 },
  permission: { color: C.muted, padding: 20, textAlign: 'center' },
  guide: { position: 'absolute', left: '8%', right: '8%', borderWidth: 2, borderStyle: 'dashed', borderRadius: 8, alignItems: 'center' },
  cardGuide: { top: '8%', height: '36%', borderColor: '#8ab4ff' },
  kitGuide: { top: '52%', height: '38%', borderColor: '#e0a33a' },
  guideText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 1, marginTop: 4, textShadowColor: '#000', textShadowRadius: 4 },
});
