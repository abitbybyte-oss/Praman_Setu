import { Link } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SimulatedBanner } from '@/src/ui/SimulatedBanner';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <SimulatedBanner />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Praman Setu</Text>
        <Text style={styles.subtitle}>Field Drug Test Companion · prototype</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Phase 0 — evidence spike</Text>
          <Text style={styles.cardBody}>
            Takes a photograph, hashes the exact bytes as written, and signs the record with this
            device&apos;s key. The result can be checked in verify.html or with Node&apos;s crypto.verify.
          </Text>
          <Link href="/spike" style={styles.link}>
            Open evidence spike
          </Link>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Phase 0 — native smoke test</Text>
          <Text style={styles.cardBody}>
            Confirms SQLite (append-only ledger triggers) and Skia (JPEG decode, downscale, pixel
            readback) work on this device.
          </Text>
          <Link href="/smoke" style={styles.link}>
            Open smoke test
          </Link>
        </View>

        <Text style={styles.note}>
          The full test workflow — kit selection, guided capture, reference-card calibration and
          classification — arrives in Phase 1.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f1219' },
  content: { padding: 20, gap: 14 },
  title: { fontSize: 30, fontWeight: '700', color: '#f2f5fa' },
  subtitle: { fontSize: 15, color: '#93a0b4', marginBottom: 10 },
  card: {
    backgroundColor: '#171c26',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#28303d',
    padding: 18,
    gap: 10,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#f2f5fa' },
  cardBody: { fontSize: 14.5, lineHeight: 21, color: '#aab6c6' },
  link: {
    marginTop: 4,
    color: '#8ab4ff',
    fontSize: 15.5,
    fontWeight: '700',
  },
  note: { fontSize: 13.5, lineHeight: 20, color: '#7a8596' },
});
