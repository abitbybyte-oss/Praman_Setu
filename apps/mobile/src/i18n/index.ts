import { en, type Strings } from './en';

/** Active UI strings. English only for now; I18N-02 (Hindi, P2) adds a
 * second `Strings` object and a language switch here. */
export const S: Strings = en;

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function when(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

/** Look up a coded value (reason, check, outcome…), falling back to the code. */
export function label(table: Record<string, string>, code: string): string {
  return table[code] ?? code;
}
