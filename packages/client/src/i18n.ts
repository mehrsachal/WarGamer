// NFR-10: every UI string comes from a translation file. English ships now; Urdu (UI-04) is a second file.
import en from './i18n/en.json';

type Dict = Record<string, string>;
const packs: Record<string, Dict> = { en };
let current: Dict = en;

export function setLanguage(lang: string): void {
  current = packs[lang] ?? en;
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const s = current[key] ?? (en as Dict)[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}
