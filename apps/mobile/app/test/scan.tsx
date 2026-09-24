import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { File } from 'expo-file-system';
import { Camera, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';

import { audit } from '@/src/adapters/db';
import { S } from '@/src/i18n';
import { decodeQrFromFile } from '@/src/services/image';
import { checkKitQr } from '@/src/services/kitqr';
import { loadRefdb } from '@/src/services/refdb';
import { Button, C, Note, Screen } from '@/src/ui/kit';
import { useSession } from '@/src/workflow/store';

/** KIT-03: photograph the kit label and decode its QR in JS. The photo is
 * deleted after decoding; the payload's SHA-256 is what the record keeps. */
export default function ScanScreen() {
  const setPendingKit = useSession((st) => st.setPendingKit);
  const { hasPermission, requestPermission } = useCameraPermission();
  const photoOutput = usePhotoOutput({ containerFormat: 'jpeg', quality: 0.9 });
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  useFocusEffect(
    useCallback(() => {
      setActive(true);
      return () => setActive(false);
    }, [])
  );

  const scan = async () => {
    setBusy(true);
    setError(null);
    try {
      const photo = await photoOutput.capturePhotoToFile({}, {});
      const uri = photo.filePath.startsWith('file://') ? photo.filePath : `file://${photo.filePath}`;
      const raw = await decodeQrFromFile(uri);
      try {
        new File(uri).delete();
      } catch {
        // temp file; the OS clears it anyway
      }
      if (raw === null) {
        setError(S.scan.notFound);
        return;
      }
      const result = checkKitQr(raw, loadRefdb().db);
      // KIT-05: a rejected kit goes to the audit log, never the evidence ledger.
      if (result.status !== 'VALID') audit('KIT_REJECTED', `${result.status} ${result.problem ?? ''} ${result.qr_sha256}`);
      setPendingKit(result);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={S.scan.title} scroll={false} footer={<Button label={busy ? S.scan.decoding : S.scan.scan} onPress={scan} busy={busy} disabled={!hasPermission} />}>
      <View style={styles.preview}>
        {hasPermission ? (
          <Camera style={StyleSheet.absoluteFill} device="back" isActive={active} outputs={[photoOutput]} />
        ) : (
          <Text style={styles.permission}>{S.capture.permission}</Text>
        )}
        <View pointerEvents="none" style={styles.frame} />
      </View>
      <Note>{S.scan.help}</Note>
      {error ? <Note tone="bad">{error}</Note> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { flex: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000', minHeight: 300 },
  permission: { color: C.muted, padding: 20, textAlign: 'center' },
  frame: { position: 'absolute', top: '20%', left: '15%', right: '15%', bottom: '20%', borderWidth: 3, borderColor: '#8ab4ff', borderRadius: 12 },
});
