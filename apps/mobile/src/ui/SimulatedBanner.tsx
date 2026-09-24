import { StyleSheet, Text, View } from 'react-native';

import { S } from '../i18n';

/** HOME-02 / PRD §2: every screen, record and printout carries this. It is
 * deliberately not dismissible. */
export function SimulatedBanner() {
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{S.app.banner}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#7a1c1c',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  text: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12.5,
    letterSpacing: 1,
    textAlign: 'center',
  },
});
