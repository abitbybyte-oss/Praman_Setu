/** I18N-01 guard: no hard-coded user-facing strings in screens or UI
 * components. Flags JSX text and literal label/title/placeholder props.
 * Developer-only screens (Phase 0 spike, smoke test) are exempt.
 * Run: npx tsx scripts/check-strings.ts */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(__dirname, '..');
const EXEMPT = new Set(['app/spike.tsx', 'app/smoke.tsx', 'app/+html.tsx', 'app/+not-found.tsx']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

const files = [...walk(join(root, 'app')), ...walk(join(root, 'src'))];
const problems: string[] = [];
for (const file of files) {
  const rel = relative(root, file).replace(/\\/g, '/');
  if (EXEMPT.has(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    // Plain words between tags; code (brackets, operators) is not UI text.
    const jsxText = />\s*([^<>{}()[\]=?;:!]*[A-Za-z]{2,}[^<>{}()[\]=?;:!]*)\s*</.exec(line);
    const prop = /\b(label|title|placeholder|dialogTitle)=["']([^"']*[A-Za-z]{2,}[^"']*)["']/.exec(line);
    if (jsxText) problems.push(`${rel}:${i + 1}  text "${jsxText[1].trim()}"`);
    if (prop) problems.push(`${rel}:${i + 1}  ${prop[1]}="${prop[2]}"`);
  });
}

if (problems.length) {
  console.log(`Hard-coded UI strings (move them to src/i18n/en.ts):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`I18N-01 OK: ${files.length} files checked, no hard-coded UI strings.`);
