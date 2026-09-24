import { useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { C } from './kit';

/** Minimal JS slider (no native module, so no dev-build rebuild needed). */
export function Slider({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  const [width, setWidth] = useState(1);
  const last = useRef(value);
  const frac = Math.min(1, Math.max(0, (value - min) / (max - min || 1)));

  const update = (e: GestureResponderEvent) => {
    const f = Math.min(1, Math.max(0, e.nativeEvent.locationX / width));
    const v = Math.round(min + f * (max - min));
    if (v !== last.current) {
      last.current = v;
      onChange(v);
    }
  };

  return (
    <View
      style={styles.hit}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={update}
      onResponderMove={update}>
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.fill, { width: `${frac * 100}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: frac * width - 13 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: 44, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: C.border, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: C.amber },
  thumb: { position: 'absolute', width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', borderWidth: 3, borderColor: C.amber, top: 9 },
});
