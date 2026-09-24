import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import { correctImage, type RgbaImage } from '@fdtc/color-core';
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

export async function workingCopy(uri: string): Promise<WorkingCopy> {
  const hit = cache.get(uri);
  if (hit) return hit;

  const data = await Skia.Data.fromURI(uri);
  const original = Skia.Image.MakeImageFromEncoded(data);
  if (!original) throw new Error('Could not decode the photo.');
  const origWidth = original.width();
  const origHeight = original.height();
  const k = Math.min(1, WORKING_LONG_SIDE / Math.max(origWidth, origHeight));
  const w = Math.max(1, Math.round(origWidth * k));
  const h = Math.max(1, Math.round(origHeight * k));

  const surface = Skia.Surface.MakeOffscreen(w, h);
  if (!surface) throw new Error('Could not allocate the working copy.');
  const paint = Skia.Paint();
  surface.getCanvas().drawImageRect(original, Skia.XYWHRect(0, 0, origWidth, origHeight), Skia.XYWHRect(0, 0, w, h), paint);
  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  const pixels = snapshot.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!pixels || pixels.length !== w * h * 4) throw new Error('Could not read the working copy pixels.');

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
export function correctedView(wc: WorkingCopy, matrix: number[]): WorkingCopy {
  const key = `${wc.img.width}x${wc.img.height}:${matrix.join(',')}`;
  if (correctedCache?.key === key) return correctedCache.view;
  const pixels = correctImage(wc.img, matrix);
  const image = Skia.Image.MakeImage(
    { width: wc.img.width, height: wc.img.height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(new Uint8Array(pixels.buffer)),
    wc.img.width * 4
  );
  const view = { ...wc, skImage: image ?? wc.skImage };
  correctedCache = { key, view };
  return view;
}

/** KIT-03: decode a QR code from a photo in pure JS (jsQR). vision-camera v5's
 * live code scanner is iOS-only, and this avoids a native rebuild. The photo
 * is a throwaway, not evidence: only the payload's hash is recorded. */
export async function decodeQrFromFile(uri: string, longSide = 1000): Promise<string | null> {
  const data = await Skia.Data.fromURI(uri);
  const original = Skia.Image.MakeImageFromEncoded(data);
  if (!original) return null;
  const k = Math.min(1, longSide / Math.max(original.width(), original.height()));
  const w = Math.max(1, Math.round(original.width() * k));
  const h = Math.max(1, Math.round(original.height() * k));
  const surface = Skia.Surface.MakeOffscreen(w, h);
  if (!surface) return null;
  surface.getCanvas().drawImageRect(original, Skia.XYWHRect(0, 0, original.width(), original.height()), Skia.XYWHRect(0, 0, w, h), Skia.Paint());
  surface.flush();
  const px = surface.makeImageSnapshot().readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!px) return null;
  const found = jsQR(new Uint8ClampedArray(px.buffer, px.byteOffset, px.byteLength), w, h, { inversionAttempts: 'dontInvert' });
  return found?.data ?? null;
}
