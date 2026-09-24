import '@/src/crypto-polyfill';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { getDb } from '@/src/adapters/db';
import { seedOperators } from '@/src/services/auth';
import { ensureGenesis } from '@/src/services/ledger';
import { loadRefdb } from '@/src/services/refdb';
import { C } from '@/src/ui/kit';
import { SimulatedBanner } from '@/src/ui/SimulatedBanner';

/** Start-up (ARCHITECTURE §14): open the ledger, verify the signed Reference
 * DB, make sure GENESIS exists, seed the demo operators. Any failure blocks the
 * app with the reason — a record that cannot be signed is not evidence. */

type Boot = { state: 'loading'; step: string } | { state: 'ready' } | { state: 'error'; message: string };

export default function RootLayout() {
  const [boot, setBoot] = useState<Boot>({ state: 'loading', step: 'Starting…' });

  useEffect(() => {
    (async () => {
      try {
        setBoot({ state: 'loading', step: 'Verifying reference data…' });
        loadRefdb();
        setBoot({ state: 'loading', step: 'Opening evidence ledger…' });
        getDb();
        await ensureGenesis();
        setBoot({ state: 'loading', step: 'Preparing operator directory…' });
        await seedOperators();
        setBoot({ state: 'ready' });
      } catch (error) {
        setBoot({ state: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.root}>
        {/* HOME-02: persistent, non-dismissible, on every screen. */}
        <TopBanner />
        {boot.state === 'ready' ? (
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }} />
        ) : (
          <View style={styles.center}>
            {boot.state === 'loading' ? (
              <>
                <ActivityIndicator color={C.link} size="large" />
                <Text style={styles.text}>{boot.step}</Text>
              </>
            ) : (
              <>
                <Text style={styles.errorTitle}>Tests are blocked</Text>
                <Text style={styles.text}>{boot.message}</Text>
              </>
            )}
          </View>
        )}
      </View>
    </SafeAreaProvider>
  );
}

function TopBanner() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bannerWrap, { paddingTop: insets.top }]}>
      <SimulatedBanner />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  bannerWrap: { backgroundColor: '#7a1c1c' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  text: { color: C.muted, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  errorTitle: { color: C.red, fontSize: 20, fontWeight: '800' },
});
