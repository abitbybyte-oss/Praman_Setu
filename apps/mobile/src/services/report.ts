import { ImageFormat } from '@shopify/react-native-skia';
import * as Print from 'expo-print';
import type { Envelope, TestRecord } from '@fdtc/evidence-core';

import { S } from '../i18n';
import { workingCopy } from './image';
import { evidencePath, voidFor } from './ledger';
import { reportHtml } from './reportHtml';

/** EXP-02: render the record as a PDF. The image in the PDF is a reduced
 * rendition; the record's photo hash refers to the untouched original file. */
export async function makeReportPdf(envelope: Envelope<TestRecord>): Promise<string> {
  const r = envelope.record;
  let imageBase64: string | null = null;
  const path = r.evidence_image ? evidencePath(r.evidence_image.sha256) : null;
  if (path) {
    try {
      imageBase64 = (await workingCopy(path)).skImage.encodeToBase64(ImageFormat.JPEG, 80);
    } catch {
      imageBase64 = null;
    }
  }
  const html = reportHtml({ envelope, imageBase64, void: voidFor(r.record_id), S, generatedAt: new Date().toISOString() });
  const { uri } = await Print.printToFileAsync({ html });
  return uri;
}
