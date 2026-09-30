import * as Haptics from 'expo-haptics';
import { useCallback, useState } from 'react';
import { Animated, Image, StyleSheet } from 'react-native';

/** Shutter feedback: a brief white flash plus a haptic tick, then the preview
 * freezes on the photo just taken while it is processed, so the user knows
 * what was captured and that it is no longer live. `release()` goes back to
 * the live preview (e.g. to retry). Pause the camera while `frozen`. */
export function useShutter() {
  const [opacity] = useState(() => new Animated.Value(0));
  const [photo, setPhoto] = useState<string | null>(null);

  const fire = useCallback(
    (uri: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      setPhoto(uri.startsWith('file://') ? uri : `file://${uri}`);
      opacity.setValue(0.85);
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start();
    },
    [opacity]
  );

  const release = useCallback(() => setPhoto(null), []);

  const overlay = (
    <>
      {photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity }]} />
    </>
  );

  return { fire, release, frozen: photo !== null, overlay };
}
