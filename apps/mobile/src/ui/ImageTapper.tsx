import { Canvas, Image as SkiaImage } from '@shopify/react-native-skia';
import type { Point } from '@fdtc/color-core';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import type { WorkingCopy } from '../services/image';

/** Shows the working copy pixel-for-pixel (so a tap maps exactly onto the
 * pixels being measured) and reports taps in working-copy coordinates.
 * `overlay(k)` draws Skia elements; k = screen px per working px. */
export function ImageTapper({
  wc,
  onTap,
  overlay,
  maxHeight,
}: {
  wc: WorkingCopy;
  onTap: (p: Point) => void;
  overlay?: (k: number) => ReactNode;
  maxHeight?: number;
}) {
  const [box, setBox] = useState(0);
  let k = box / wc.img.width;
  if (maxHeight && wc.img.height * k > maxHeight) k = maxHeight / wc.img.height;
  const w = wc.img.width * k;
  const h = wc.img.height * k;

  return (
    <View onLayout={(e) => setBox(e.nativeEvent.layout.width)} style={{ width: '100%', alignItems: 'center' }}>
      {box > 0 ? (
        <Pressable onPress={(e) => onTap([e.nativeEvent.locationX / k, e.nativeEvent.locationY / k])}>
          <Canvas style={{ width: w, height: h }}>
            <SkiaImage image={wc.skImage} x={0} y={0} width={w} height={h} fit="fill" />
            {overlay?.(k)}
          </Canvas>
        </Pressable>
      ) : null}
    </View>
  );
}
