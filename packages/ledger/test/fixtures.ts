// golden tests อ่านตัวเลขจาก fixtures/sample-company.json เท่านั้น (CLAUDE.md)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { JournalLineTuple } from '../src/index.ts';

const path = fileURLToPath(new URL('../../../fixtures/sample-company.json', import.meta.url));

interface FixtureDoc {
  readonly expected_journal?: readonly JournalLineTuple[];
  readonly subtotal?: string;
  readonly vat?: string;
  readonly grand_total?: string;
}
interface Fixtures {
  readonly documents: Readonly<Record<string, FixtureDoc>>;
}

export const fixtures = JSON.parse(readFileSync(path, 'utf8')) as Fixtures;

export function doc(no: string): FixtureDoc {
  const d = fixtures.documents[no];
  if (!d) throw new Error(`ไม่พบเอกสาร ${no} ใน fixtures`);
  return d;
}
