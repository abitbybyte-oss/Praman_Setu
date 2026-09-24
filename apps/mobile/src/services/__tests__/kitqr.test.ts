import { describe, expect, it } from 'vitest';

import { checkKitQr, formatKitQr, localDate, type KitQr } from '../kitqr';

const refdb = { kits: { 'SIM-A': {}, 'SIM-B': {} }, manufacturers: ['Demo Labs'] };
const kit: KitQr = { kit_id: 'SIMKIT-000871', kit_type: 'SIM-A', manufacturer: 'Demo Labs', batch: 'B2026-07', mfg_date: '2026-01-10', expiry_date: '2027-01-10' };
const TODAY = '2026-09-24';

describe('kit QR (PRD §8.3, TC-04..07)', () => {
  it('TC-04 valid kit → VALID with its fields', () => {
    const r = checkKitQr(formatKitQr(kit), refdb, TODAY);
    expect(r.status).toBe('VALID');
    expect(r.kit).toEqual(kit);
    expect(r.qr_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('TC-05 expired kit → EXPIRED', () => {
    expect(checkKitQr(formatKitQr({ ...kit, expiry_date: '2026-09-23' }), refdb, TODAY).status).toBe('EXPIRED');
  });

  it('expiry day itself is still valid; manufacture day itself is valid', () => {
    expect(checkKitQr(formatKitQr({ ...kit, expiry_date: TODAY }), refdb, TODAY).status).toBe('VALID');
    expect(checkKitQr(formatKitQr({ ...kit, mfg_date: TODAY }), refdb, TODAY).status).toBe('VALID');
  });

  it('manufactured in the future → NOT_YET_VALID (possible clock problem)', () => {
    expect(checkKitQr(formatKitQr({ ...kit, mfg_date: '2026-10-01' }), refdb, TODAY).status).toBe('NOT_YET_VALID');
  });

  it('TC-07 random text → UNRECOGNISED, no crash', () => {
    for (const raw of ['hello world', '', 'https://example.com', 'FDTC-KIT', 'FDTC-KIT|1|a|b', '|||||||||']) {
      const r = checkKitQr(raw, refdb, TODAY);
      expect(r.status).toBe('UNRECOGNISED');
      expect(r.problem).not.toBeNull();
    }
  });

  it('unknown kit type, unknown manufacturer, bad dates, not simulated → UNRECOGNISED', () => {
    expect(checkKitQr(formatKitQr({ ...kit, kit_type: 'REAL-X' }), refdb, TODAY).problem).toBe('UNKNOWN_KIT_TYPE');
    expect(checkKitQr(formatKitQr({ ...kit, manufacturer: 'Acme' }), refdb, TODAY).problem).toBe('UNKNOWN_MANUFACTURER');
    expect(checkKitQr(formatKitQr({ ...kit, expiry_date: '2027-02-30' }), refdb, TODAY).problem).toBe('BAD_DATE');
    expect(checkKitQr(formatKitQr({ ...kit, mfg_date: '2027-02-01' }), refdb, TODAY).problem).toBe('BAD_DATE');
    expect(checkKitQr(formatKitQr(kit).replace('SIMULATED', 'REAL'), refdb, TODAY).problem).toBe('NOT_SIMULATED');
  });

  it('the hash is of the exact raw payload', () => {
    const a = checkKitQr(formatKitQr(kit), refdb, TODAY).qr_sha256;
    const b = checkKitQr(formatKitQr(kit) + ' ', refdb, TODAY).qr_sha256;
    expect(a).not.toBe(b);
  });

  it('localDate formats the local calendar date', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
