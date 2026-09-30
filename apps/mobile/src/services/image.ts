import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import { correctImage, type RgbaImage } from '@fdtc/color-core';
import { File } from 'expo-file-system';
import jsQR from 'jsqr';

/** Working copy (ARCHITECTURE §6.1): Skia decodes the original JPEG (applying
 * its orientation), downscales the long side to 1600 px and reads RGBA pixels.
 * Disposable: the original file is never touched or re-encoded. */

export const WORKING_LONG_SIDE = 1600;

export interface WorkingCopy {
  img: RgbaImage;
  /** For on-screen display, pixel-identical to `img`. */
  skImage: SkImage;
  /** Original px per working px. */
  scale: number;
  origWidth: number;
  origHeight: number;
}

const cache = new Map<string, WorkingCopy>();

/** CPU surface: a GPU (offscreen) surface can stall while the camera is still
 * releasing its own GPU session right after a capture. */
function rasterSurface(w: number, h: number) {
  return Skia.Surface.Make(w, h) ?? Skia.Surface.MakeOffscreen(w, h);
}

/** Read the photo through expo-file-system: Skia.Data.fromURI was seen never
 * to settle on Android after the first photo of a session. */
async function readPhoto(uri: string) {
  const bytes = await new File(uri.startsWith('file://') ? uri : `file://${uri}`).bytes();
  return Skia.Data.fromBytes(bytes);
}

export async function workingCopy(uri: string): Promise<WorkingCopy> {
  const hit = cache.get(uri);
  if (hit) return hit;

  const t0 = Date.now();
  const step = (s: string) => __DEV__ && console.log('[WC]', s, Date.now() - t0, 'ms');
  const data = await readPhoto(uri);
  step('file read');
  const original = Skia.Image.MakeImageFromEncoded(data);
  if (!original) throw new Error('Could not decode the photo.');
  step('decoded');
  const origWidth = original.width();
  const origHeight = original.height();
  const k = Math.min(1, WORKING_LONG_SIDE / Math.max(origWidth, origHeight));
  const w = Math.max(1, Math.round(origWidth * k));
  const h = Math.max(1, Math.round(origHeight * k));

  const surface = rasterSurface(w, h);
  if (!surface) throw new Error('Could not allocate the working copy.');
  const paint = Skia.Paint();
  surface.getCanvas().drawImageRect(original, Skia.XYWHRect(0, 0, origWidth, origHeight), Skia.XYWHRect(0, 0, w, h), paint);
  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  const pixels = snapshot.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!pixels || pixels.length !== w * h * 4) throw new Error('Could not read the working copy pixels.');
  step('pixels read');

  // Offscreen snapshots are GPU-backed; make a raster copy that is safe to draw anywhere.
  const skImage = snapshot.makeNonTextureImage() ?? snapshot;
  const wc: WorkingCopy = {
    img: { width: w, height: h, data: pixels as Uint8Array },
    skImage,
    scale: origWidth / w,
    origWidth,
    origHeight,
  };
  cache.clear(); // one test at a time; keep memory bounded
  cache.set(uri, wc);
  return wc;
}

let correctedCache: { key: string; view: WorkingCopy } | null = null;

/** ROI-01: the same working copy, displayed colour-corrected. Only the display
 * image changes; taps map to the same pixels and measurement still runs on the
 * raw pixels (it applies the matrix itself). */
export function correctedView(wc: WorkingCopy, matrix: number[], gamma = 1): WorkingCopy {
  const key = `${wc.img.width}x${wc.img.height}:${gamma}:${matrix.join(',')}`;
  if (correctedCache?.key === key) return correctedCache.view;
  const pixels = correctImage(wc.img, matrix, gamma);
  const image = Skia.Image.MakeImage(
    { width: wc.img.width, height: wc.img.height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(new Uint8Array(pixels.buffer)),
    wc.img.width * 4
  );
  const view = { ...wc, skImage: image ?? wc.skImage };
  correctedCache = { key, view };
  return view;
}

/** KIT-03: decode a QR code from a photo. vision-camera v5's code scanner is
 * iOS-only, so this uses expo-camera's native scanner (ML Kit on Android),
 * falling back to jsQR on a build without it. The photo is a throwaway, not
 * evidence: only the payload's hash is recorded. */
const NATIVE_SCAN_TIMEOUT_MS = 4000;

export async function decodeQrFromFile(uri: string): Promise<string | null> {
  let scanner: typeof import('expo-camera').Camera | null = null;
  try {
    // Lazy: a dev build without the native module must not crash on import.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    scanner = (require('expo-camera') as typeof import('expo-camera')).Camera;
  } catch {
    scanner = null;
  }
  if (scanner) {
    try {
      const t0 = Date.now();
      // On Android the native call never settles when expo-image-loader is not
      // linked (it null-checks the loader and drops the promise), so bound it.
      const codes = await Promise.race([
        scanner.scanFromURLAsync(uri, ['qr']),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('native QR scan timed out')), NATIVE_SCAN_TIMEOUT_MS)),
      ]);
      if (__DEV__) console.log('[QR] native', codes.length, 'code(s)', Date.now() - t0, 'ms');
      // Prefer a kit label if the reference card's QR is also in the photo.
      const kit = codes.find((c) => c.data.startsWith('FDTC-KIT|'));
      return (kit ?? codes[0])?.data ?? null;
    } catch (e) {
      if (__DEV__) console.log('[QR] native scanner unavailable, using jsQR:', e instanceof Error ? e.message : e);
    }
  }
  return decodeQrJs(uri);
}

async function decodeQrJs(uri: string): Promise<string | null> {
  const data = await readPhoto(uri);
  const original = Skia.Image.MakeImageFromEncoded(data);
  if (!original) return null;
  const W = original.width();
  const H = original.height();
  // jsQR runs in the JS interpreter and slows sharply on busy backgrounds
  // (tens of seconds for a full photo on Hermes), so read only the on-screen
  // frame, small. The preview is cropped to fill, so the frame maps to at most
  // the centre region of the photo; the user is asked to fill it with the label.
  const passes: { x: number; y: number; w: number; h: number; longSide: number }[] = [
    { x: W * 0.15, y: H * 0.15, w: W * 0.7, h: H * 0.7, longSide: 600 },
    { x: W * 0.25, y: H * 0.25, w: W * 0.5, h: H * 0.5, longSide: 600 },
    { x: 0, y: 0, w: W, h: H, longSide: 800 },
  ];
  const deadline = Date.now() + 8000;
  if (__DEV__) console.log('[QR] photo', W, 'x', H);
  for (const p of passes) {
    if (Date.now() > deadline) break;
    const t0 = Date.now();
    const k = Math.min(1, p.longSide / Math.max(p.w, p.h));
    const w = Math.max(1, Math.round(p.w * k));
    const h = Math.max(1, Math.round(p.h * k));
    const surface = rasterSurface(w, h);
    if (!surface) continue;
    surface.getCanvas().drawImageRect(original, Skia.XYWHRect(p.x, p.y, p.w, p.h), Skia.XYWHRect(0, 0, w, h), Skia.Paint());
    surface.flush();
    const px = surface.makeImageSnapshot().readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    if (!px) continue;
    const found = jsQR(new Uint8ClampedArray(px.buffer, px.byteOffset, px.byteLength), w, h, { inversionAttempts: 'dontInvert' });
    if (__DEV__) console.log('[QR] pass', Math.round(p.w), 'x', Math.round(p.h), '->', w, 'x', h, found ? 'FOUND' : 'none', Date.now() - t0, 'ms');
    if (found?.data) return found.data;
  }
  return null;
}
