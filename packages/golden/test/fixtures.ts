// golden tests อ่านตัวเลขจาก fixtures/sample-company.json เท่านั้น (CLAUDE.md · PLAN §3)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { JournalLineTuple } from '@innovera/ledger';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export interface FxDoc { [k: string]: Json | undefined; expected_journal?: JournalLineTuple[] & Json; expected_reversal?: JournalLineTuple[] & Json }

const fx = JSON.parse(readFileSync(fileURLToPath(new URL('../../../fixtures/sample-company.json', import.meta.url)), 'utf8')) as {
  documents: Record<string, FxDoc>;
  fixed_assets: Record<string, Json>[];
  year_end_2569_preview: Record<string, JournalLineTuple[]>;
  wht_rates: Record<string, { rate: number; pnd: string; status?: string }>;
};
export const fixtures = fx;
export function doc(no: string): FxDoc {
  const d = fx.documents[no];
  if (!d) throw new Error(`ไม่พบ ${no} ใน fixtures`);
  return d;
}
export const s = (v: Json | undefined): string => {
  if (typeof v !== 'string') throw new Error(`ต้องเป็น string ได้ ${JSON.stringify(v)}`);
  return v;
};
/** ปีพ.ศ. 'YYYY-MM-DD' → ค.ศ. */
export const toCE = (be: string): string => `${Number(be.slice(0, 4)) - 543}${be.slice(4)}`;
