import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import { Directory, Paths } from 'expo-file-system';
import { openDatabaseSync } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SimulatedBanner } from '@/src/ui/SimulatedBanner';

/** Phase 0 native smoke test: SQLite (ledger triggers, transactions) and Skia
 * (offscreen render, JPEG decode, downscale, readPixels -> RGBA). These are the
 * two native modules Phase 1 leans on, so a crash here is better found now. */

interface Step {
  name: string;
  ok: boolean;
  detail: string;
}

const LONG_SIDE = 1600;

function testSqlite(): Step[] {
  const steps: Step[] = [];
  const db = openDatabaseSync('smoke-test.db');
  db.execSync(`
    DROP TABLE IF EXISTS ledger;
    CREATE TABLE ledger (
      seq INTEGER PRIMARY KEY,
      record_id TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL
    );
    CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger
      BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
    CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger
      BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
  `);
  steps.push({ name: 'SQLite: open + create schema and triggers', ok: true, detail: 'smoke-test.db' });

  db.withTransactionSync(() => {
    db.runSync('INSERT INTO ledger (seq, record_id, payload) VALUES (?, ?, ?)', 0, 'r-0', '{"a":1}');
    db.runSync('INSERT INTO ledger (seq, record_id, payload) VALUES (?, ?, ?)', 1, 'r-1', '{"a":2}');
  });
  const rows = db.getAllSync<{ seq: number }>('SELECT seq FROM ledger ORDER BY seq');
  steps.push({
    name: 'SQLite: transactional insert + read back',
    ok: rows.length === 2,
    detail: `${rows.length} rows`,
  });

  let updateBlocked = false;
  try {
    db.runSync("UPDATE ledger SET payload = 'tampered' WHERE seq = 0");
  } catch (e) {
    updateBlocked = String(e).includes('append-only');
  }
  steps.push({ name: 'SQLite: UPDATE blocked by trigger', ok: updateBlocked, detail: 'ledger is append-only' });

  let deleteBlocked = false;
  try {
    db.runSync('DELETE FROM ledger WHERE seq = 1');
  } catch (e) {
    deleteBlocked = String(e).includes('append-only');
  }
  steps.push({ name: 'SQLite: DELETE blocked by trigger', ok: deleteBlocked, detail: 'ledger is append-only' });

  let rolledBack = false;
  try {
    db.withTransactionSync(() => {
      db.runSync('INSERT INTO ledger (seq, record_id, payload) VALUES (?, ?, ?)', 2, 'r-2', '{}');
      db.runSync('INSERT INTO ledger (seq, record_id, payload) VALUES (?, ?, ?)', 3, 'r-0', '{}'); // duplicate id
    });
  } catch {
    rolledBack = db.getAllSync('SELECT seq FROM ledger').length === 2;
  }
  steps.push({ name: 'SQLite: failed transaction rolls back atomically', ok: rolledBack, detail: 'still 2 rows' });
  return steps;
}

function testSkiaOffscreen(): Step[] {
  const surface = Skia.Surface.MakeOffscreen(64, 64);
  if (!surface) return [{ name: 'Skia: offscreen surface', ok: false, detail: 'MakeOffscreen returned null' }];
  const canvas = surface.getCanvas();
  canvas.drawColor(Skia.Color('rgb(200, 40, 90)'));
  surface.flush();
  const pixels = surface.makeImageSnapshot().readPixels(0, 0, {
    width: 64,
    height: 64,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  const p = pixels ? Array.from(pixels.slice(0, 4)) : [];
  const exact = p[0] === 200 && p[1] === 40 && p[2] === 90 && p[3] === 255;
  return [
    {
      name: 'Skia: offscreen draw + readPixels (RGBA)',
      ok: exact,
      detail: `pixel[0] = [${p.join(', ')}], expected [200, 40, 90, 255]`,
    },
  ];
}

async function testSkiaDecode(): Promise<Step[]> {
  const evidence = new Directory(Paths.document, 'evidence');
  if (!evidence.exists) {
    return [{ name: 'Skia: decode a real capture', ok: false, detail: 'No captures yet — take one on the spike screen first.' }];
  }
  let latest: { uri: string; modified: number } | null = null;
  for (const entry of evidence.list()) {
    if (!(entry instanceof Directory)) continue;
    for (const f of entry.list()) {
      if (f instanceof Directory || !f.uri.endsWith('.jpg')) continue;
      const modified = f.modificationTime ?? 0;
      if (!latest || modified >= latest.modified) latest = { uri: f.uri, modified };
    }
  }
  if (!latest) {
    return [{ name: 'Skia: decode a real capture', ok: false, detail: 'No .jpg in evidence/ — take one on the spike screen.' }];
  }

  const t0 = Date.now();
  const data = await Skia.Data.fromURI(latest.uri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) return [{ name: 'Skia: decode a real capture', ok: false, detail: 'MakeImageFromEncoded returned null' }];
  const t1 = Date.now();

  const { width, height } = image.width() > 0 ? { width: image.width(), height: image.height() } : { width: 0, height: 0 };
  const scale = Math.min(1, LONG_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const surface = Skia.Surface.MakeOffscreen(w, h);
  if (!surface) return [{ name: 'Skia: downscale to working copy', ok: false, detail: 'MakeOffscreen returned null' }];
  const paint = Skia.Paint();
  surface.getCanvas().drawImageRect(image, Skia.XYWHRect(0, 0, width, height), Skia.XYWHRect(0, 0, w, h), paint);
  surface.flush();
  const pixels = surface.makeImageSnapshot().readPixels(0, 0, {
    width: w,
    height: h,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  const t2 = Date.now();

  const expected = w * h * 4;
  const okBuf = !!pixels && pixels.length === expected;
  let mean = '';
  if (pixels) {
    let r = 0;
    let g = 0;
    let b = 0;
    const n = w * h;
    for (let i = 0; i < pixels.length; i += 4) {
      r += pixels[i];
      g += pixels[i + 1];
      b += pixels[i + 2];
    }
    mean = ` · mean RGB [${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)}]`;
  }
  return [
    { name: 'Skia: decode real JPEG', ok: width > 0 && height > 0, detail: `${width}×${height} in ${t1 - t0} ms` },
    {
      name: `Skia: downscale to ${LONG_SIDE}px working copy + readPixels`,
      ok: okBuf,
      detail: `${w}×${h}, ${pixels?.length ?? 0} bytes (expected ${expected}) in ${t2 - t1} ms${mean}`,
    },
  ];
}

export default function SmokeScreen() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setSteps([]);
    const all: Step[] = [];
    const guard = async (label: string, fn: () => Step[] | Promise<Step[]>) => {
      try {
        all.push(...(await fn()));
      } catch (e) {
        all.push({ name: label, ok: false, detail: `threw: ${e instanceof Error ? e.message : String(e)}` });
      }
      setSteps([...all]);
    };
    await guard('SQLite', testSqlite);
    await guard('Skia offscreen', testSkiaOffscreen);
    await guard('Skia decode', testSkiaDecode);
    setRunning(false);
  }, []);

  const passed = steps.filter((s) => s.ok).length;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <SimulatedBanner />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Native smoke test</Text>
        <Text style={styles.help}>
          Checks SQLite and Skia on this device. Take a photo on the evidence spike screen first so
          the decode step has a real image.
        </Text>
        <Pressable style={styles.button} onPress={run} disabled={running}>
          <Text style={styles.buttonText}>{running ? 'Running…' : 'Run smoke test'}</Text>
        </Pressable>

        {steps.length > 0 ? (
          <Text style={styles.summary}>
            {passed}/{steps.length} passed
          </Text>
        ) : null}
        {steps.map((s) => (
          <View key={s.name} style={styles.row}>
            <Text style={[styles.mark, s.ok ? styles.ok : styles.bad]}>{s.ok ? 'PASS' : 'FAIL'}</Text>
            <View style={styles.rowBody}>
              <Text style={styles.name}>{s.name}</Text>
              <Text style={styles.detail}>{s.detail}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f1219' },
  content: { padding: 18, gap: 12 },
  title: { fontSize: 24, fontWeight: '700', color: '#f2f5fa' },
  help: { fontSize: 14, lineHeight: 20, color: '#93a0b4' },
  button: { backgroundColor: '#2354e6', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  summary: { fontSize: 16, fontWeight: '700', color: '#f2f5fa' },
  row: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#171c26',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#28303d',
    padding: 12,
  },
  rowBody: { flex: 1, gap: 2 },
  mark: { fontSize: 13, fontWeight: '800', width: 40 },
  ok: { color: '#4cd08a' },
  bad: { color: '#ff6b6b' },
  name: { fontSize: 14.5, color: '#f2f5fa', fontWeight: '600' },
  detail: { fontSize: 13, color: '#93a0b4' },
});
