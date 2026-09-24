import * as ExpoCrypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';

import { getDeviceIdentity, type DeviceIdentity } from '@/src/adapters/keystore';
import {
  appendSpikeRecord,
  chainLength,
  currentExport,
  ensureGenesis,
} from '@/src/services/chain';
import { storeCapture, writeJsonFile } from '@/src/services/evidence';
import { SimulatedBanner } from '@/src/ui/SimulatedBanner';

/** Phase 0 spike: photograph -> hash the exact bytes -> sign -> export.
 *
 * Exit criteria: the exported record verifies in verify.html and in Node's
 * crypto.verify. The full guided-capture workflow is Phase 1. */

interface SpikeResult {
  recordHash: string;
  imageSha256: string;
  imageUri: string;
  seq: number;
}

export default function SpikeScreen() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const photoOutput = usePhotoOutput();

  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [result, setResult] = useState<SpikeResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState('http://10.0.2.2:8080');
  const [registration, setRegistration] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    (async () => {
      try {
        await ensureGenesis();
        setIdentity(await getDeviceIdentity());
      } catch (caught) {
        setError(describe(caught));
      }
    })();
  }, []);

  const capture = useCallback(async () => {
    setBusy('Capturing…');
    setError(null);
    try {
      const photo = await photoOutput.capturePhotoToFile({}, {});
      setBusy('Hashing and signing…');

      const recordId = ExpoCrypto.randomUUID();
      const stored = await storeCapture(photo.filePath, recordId, 1);
      const envelope = await appendSpikeRecord({
        capture: stored,
        recordId,
        width: 0,
        height: 0,
      });

      setResult({
        recordHash: envelope.record_hash,
        imageSha256: stored.sha256,
        imageUri: stored.uri,
        seq: (envelope.record as { seq: number }).seq,
      });
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(null);
    }
  }, [photoOutput]);

  const shareRecord = useCallback(async () => {
    setBusy('Preparing export…');
    try {
      const file = writeJsonFile('evidence.json', await currentExport());
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json' });
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(null);
    }
  }, []);

  const sharePhoto = useCallback(async () => {
    if (!result) return;
    try {
      await Sharing.shareAsync(result.imageUri, { mimeType: 'image/jpeg' });
    } catch (caught) {
      setError(describe(caught));
    }
  }, [result]);

  const register = useCallback(async () => {
    setBusy('Registering device key…');
    setRegistration(null);
    try {
      const genesis = await ensureGenesis();
      const response = await fetch(`${serverUrl.replace(/\/$/, '')}/v1/devices/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ envelope: genesis, badge_id: '1234' }),
      });
      const body = (await response.json()) as { key_id?: string; error?: string; detail?: string };
      setRegistration(
        response.ok
          ? `Registered ${body.key_id}. verify.html can now check this signer against the registry.`
          : `Rejected: ${body.error ?? response.status} ${body.detail ?? ''}`
      );
    } catch (caught) {
      setRegistration(`Could not reach the server: ${describe(caught)}`);
    } finally {
      setBusy(null);
    }
  }, [serverUrl]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <SimulatedBanner />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.preview}>
          {hasPermission ? (
            <Camera style={StyleSheet.absoluteFill} device="back" isActive outputs={[photoOutput]} />
          ) : (
            <Text style={styles.permission}>
              Camera permission is required. Grant it in Settings to run the spike.
            </Text>
          )}
        </View>

        <Pressable
          style={[styles.button, (!hasPermission || busy !== null) && styles.buttonDisabled]}
          disabled={!hasPermission || busy !== null}
          onPress={capture}>
          <Text style={styles.buttonText}>Capture, hash and sign</Text>
        </Pressable>

        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color="#8ab4ff" />
            <Text style={styles.busyText}>{busy}</Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Section title="This device">
          <Field label="Device" value={identity?.deviceId ?? '…'} />
          <Field label="Key" value={identity?.keyId ?? '…'} />
          <Field label="Records in chain" value={String(chainLength())} />
        </Section>

        {result ? (
          <Section title="Signed record">
            <Field label="Chain position" value={`seq ${result.seq}`} />
            <Field label="Record hash" value={result.recordHash} mono />
            <Field label="Image SHA-256" value={result.imageSha256} mono />
            <View style={styles.row}>
              <Pressable style={[styles.button, styles.small]} onPress={shareRecord}>
                <Text style={styles.buttonText}>Share record JSON</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.small, styles.secondary]} onPress={sharePhoto}>
                <Text style={styles.buttonText}>Share photo</Text>
              </Pressable>
            </View>
          </Section>
        ) : null}

        <Section title="Agency key registry (optional)">
          <Text style={styles.help}>
            Registering lets verify.html confirm a known device signed the record, rather than only
            that the record is internally consistent.
          </Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://10.0.2.2:8080"
            placeholderTextColor="#5d6879"
          />
          <Pressable style={[styles.button, styles.small]} onPress={register}>
            <Text style={styles.buttonText}>Register this device key</Text>
          </Pressable>
          {registration ? <Text style={styles.help}>{registration}</Text> : null}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, mono && styles.monoValue]} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f1219' },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  preview: {
    height: 300,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permission: { color: '#aab6c6', textAlign: 'center', padding: 24, fontSize: 14.5, lineHeight: 21 },
  button: {
    backgroundColor: '#1d4ed8',
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 9,
    alignItems: 'center',
  },
  secondary: { backgroundColor: '#2c3545' },
  small: { flex: 1, paddingVertical: 11 },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  busyText: { color: '#93a0b4', fontSize: 14 },
  error: { color: '#ff8a80', fontSize: 14, lineHeight: 20 },
  section: {
    backgroundColor: '#171c26',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#28303d',
    padding: 16,
    gap: 10,
  },
  sectionTitle: {
    color: '#93a0b4',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  field: { gap: 2 },
  fieldLabel: { color: '#7a8596', fontSize: 12.5 },
  fieldValue: { color: '#e8ebf0', fontSize: 14.5 },
  monoValue: { fontFamily: 'SpaceMono', fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  help: { color: '#8b97a8', fontSize: 13.5, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderColor: '#323c4c',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#e8ebf0',
    backgroundColor: '#11151d',
    fontSize: 14.5,
  },
  reset: { color: '#7a8596', fontSize: 13, textAlign: 'center', paddingVertical: 8 },
});
