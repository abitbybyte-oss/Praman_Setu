import QRCode from 'qrcode';
import { formatQrPayload, type Envelope, type TestRecord, type VoidRecord } from '@fdtc/evidence-core';

import type { Strings } from '../i18n/en';

/** PDF report (PRD EXP-02, EXP-03, DEMO-01). Pure: builds the HTML that
 * expo-print turns into a PDF, so it can be rendered and checked in Node.
 * Everything from the record is escaped — the report is never a place where
 * record content becomes markup. */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** QR code as an inline SVG (no network, no native module). */
export function qrSvg(text: string, sizeMm = 38): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 4;
  const total = n + quiet * 2;
  let path = '';
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${sizeMm}mm" height="${sizeMm}mm" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

export interface ReportInput {
  envelope: Envelope<TestRecord>;
  /** JPEG rendition of the evidence photo, base64 (no data: prefix), or null. */
  imageBase64: string | null;
  void: VoidRecord | null;
  S: Strings;
  generatedAt: string;
}

export function reportHtml({ envelope, imageBase64, void: v, S, generatedAt }: ReportInput): string {
  const r = envelope.record;
  const c = r.classification;
  const P = S.pdf;
  const e = escapeHtml;
  const o = S.outcome[c.outcome];
  const row = (k: string, val: string) => `<tr><th>${e(k)}</th><td>${e(val)}</td></tr>`;
  const mono = (k: string, val: string) => `<tr><th>${e(k)}</th><td class="mono">${e(val)}</td></tr>`;
  const flags = [
    r.integrity.rooted && S.integrity.flags.rooted,
    r.integrity.mock_location && S.integrity.flags.mock_location,
    r.integrity.clock_skew && S.integrity.flags.clock_skew,
    r.integrity.location_unavailable && S.integrity.flags.location_unavailable,
  ].filter(Boolean) as string[];
  const qr = formatQrPayload(envelope as Envelope);

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 14mm; }
  body { font-family: -apple-system, Roboto, Arial, sans-serif; color: #111; font-size: 10.5pt; margin: 0; }
  .wm { position: fixed; top: 38%; left: -10%; width: 120%; text-align: center; transform: rotate(-30deg);
        font-size: 54pt; font-weight: 900; color: rgba(139,26,26,0.12); letter-spacing: 4px; z-index: 0; }
  .band { background: #7a1c1c; color: #fff; text-align: center; font-weight: 800; letter-spacing: 1px; padding: 5px; font-size: 10pt; }
  h1 { font-size: 16pt; margin: 8px 0 2px; } .sub { color: #555; margin: 0 0 8px; font-size: 9pt; }
  .result { border: 2px solid ${c.outcome === 'PRELIMINARY_POSITIVE' ? '#b33' : c.outcome === 'PRELIMINARY_NEGATIVE' ? '#2a7a4a' : '#b8860b'};
            border-radius: 6px; padding: 8px 10px; margin: 8px 0; position: relative; z-index: 1; }
  .result .t { font-size: 15pt; font-weight: 800; } .void { border: 2px solid #b33; background: #fbeaea; padding: 8px 10px; border-radius: 6px; margin: 8px 0; }
  table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; position: relative; z-index: 1; }
  th { text-align: left; color: #555; font-weight: 600; width: 34%; padding: 3px 6px 3px 0; vertical-align: top; font-size: 9.5pt; }
  td { padding: 3px 0; vertical-align: top; } .mono { font-family: monospace; font-size: 8pt; word-break: break-all; }
  h2 { font-size: 11pt; margin: 10px 0 2px; border-bottom: 1px solid #ccc; padding-bottom: 2px; }
  .cols { display: flex; gap: 12px; } .cols > div { flex: 1; min-width: 0; }
  img { max-width: 100%; max-height: 90mm; border: 1px solid #ccc; }
  .qr { text-align: center; } .qr .cap { font-size: 7.5pt; color: #555; }
  .note { font-size: 8.5pt; color: #444; } .flag { display: inline-block; border: 1px solid #b8860b; color: #7a5a00; border-radius: 10px; padding: 1px 7px; margin: 1px; font-size: 8.5pt; }
  .foot { margin-top: 10px; font-size: 8pt; color: #555; border-top: 1px solid #ccc; padding-top: 5px; }
</style></head><body>
<div class="wm">${e(S.app.banner)}</div>
<div class="band">${e(S.app.banner)}</div>
<h1>${e(P.title)}</h1>
<p class="sub">${e(P.subtitle(r.record_id, r.seq))}</p>
${v ? `<div class="void"><b>${e(S.record.voidedTitle)}</b><br>${e(S.record.voidedBody(v.operator.badge_id, v.created_at, v.reason))}</div>` : ''}
<div class="result">
  <div class="t">${e(o.title)}</div>
  ${c.outcome !== 'INCONCLUSIVE' ? `<div>${e(S.result.confidence(`${Math.round(c.confidence * 100)}%`))} · ΔE00 ${e(String(c.d1_de00 ?? '—'))}</div>` : ''}
  ${c.inconclusive_reasons.length ? `<div>${c.inconclusive_reasons.map((x) => e(S.reason[x] ?? x)).join(' · ')}</div>` : ''}
  ${c.recommended_action ? `<div><b>${e(S.action[c.recommended_action] ?? c.recommended_action)}</b></div>` : ''}
  <div class="note">${e(o.always)}</div>
</div>
<div class="cols">
  <div>
    <h2>${e(P.details)}</h2>
    <table>
      ${row(S.record.created, r.created_at)}
      ${row(S.result.operator, `${r.operator.badge_id} (${S.role[r.operator.role] ?? r.operator.role})`)}
      ${row(S.result.kit, `${r.kit.display_name} (${r.kit.kit_type}) · ${S.kit.status[r.kit.status] ?? r.kit.status}`)}
      ${r.kit.kit_id ? row(P.kitId, `${r.kit.kit_id} · ${r.kit.batch ?? ''} · exp ${r.kit.expiry_date ?? ''}`) : ''}
      ${row(S.result.caseId, r.case.case_id ?? '—')}
      ${row(S.result.witness, r.case.witness_badge_id ?? '—')}
      ${row(S.result.timingSection, r.timing.timer === 'NONE' ? S.result.timingNoTimer : `${r.timing.elapsed_s ?? '—'} s (${r.timing.required_s}–${r.timing.max_s} s)${r.timing.in_window === false ? ` · ${S.result.no}` : ''}`)}
      ${row(S.result.location, r.location ? `${r.location.lat}, ${r.location.lon} (±${r.location.accuracy_m ?? '?'} m)` : S.record.unavailable)}
      ${row(S.result.card, r.calibration ? `${r.calibration.card_version} · ${r.calibration.card_status}${r.calibration.residual_de00_mean != null ? ` · ΔE00 ${r.calibration.residual_de00_mean}` : ''}` : '—')}
      ${r.quality ? row(S.result.quality, `${r.quality.score} / 100 — ${S.result.band[r.quality.band] ?? r.quality.band}`) : ''}
      ${r.measurement ? row(S.record.sampleLab, r.measurement.lab.join(', ')) : ''}
      ${row(S.result.captures, S.result.capturesRecordedLine(r.captures.length, r.retake_count))}
      ${row(S.result.refdb, r.reference_db.version)}
    </table>
    ${flags.length ? `<div>${flags.map((f) => `<span class="flag">${e(f)}</span>`).join(' ')}</div>` : ''}
  </div>
  <div>
    ${imageBase64 ? `<img src="data:image/jpeg;base64,${imageBase64}"/><p class="note">${e(P.imageNote)}</p>` : `<p class="note">${e(P.noImage)}</p>`}
    <div class="qr">${qrSvg(qr)}<div class="cap">${e(P.qrCaption)}</div></div>
  </div>
</div>
<h2>${e(P.integrity)}</h2>
<table>
  ${row(S.result.chainPos, `seq ${r.seq}`)}
  ${mono(S.result.recordHash, envelope.record_hash)}
  ${mono(P.prevHash, r.prev_hash)}
  ${mono(S.result.photoHash, r.evidence_image?.sha256 ?? '—')}
  ${mono(P.keyId, envelope.signature.key_id)}
  ${mono(S.result.signature, `${envelope.signature.alg} ${envelope.signature.value}`)}
</table>
<p class="note">${e(P.howToVerify)}</p>
<div class="foot">${e(P.footer(generatedAt))}</div>
</body></html>`;
}
