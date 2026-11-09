// Posting Engine: เอกสาร (ข้อเท็จจริงที่คำนวณแล้ว) + สูตร (ข้อมูล) → journal lines · pure TS (ADR-002)
import { assertBalanced, isAccountCode, type JournalLine, type Side } from './journal.ts';
import { Money, type MoneyString } from './money.ts';

/** แหล่งของบัญชี — ลำดับตาม PLAN §3: บรรทัดเอกสาร → สินค้า → คู่ค้า → ค่าตั้งต้นของสูตร → error */
export type AccountSource = 'line' | 'product' | 'contact.ar' | 'contact.ap' | `input.${string}`;
export interface AccountResolver {
  /** ลองตามลำดับ · ว่าง = ใช้ default เท่านั้น */
  readonly from?: readonly AccountSource[];
  readonly default?: string;
}

export interface RuleLine {
  readonly side: Side;
  readonly account: AccountResolver;
  /** ยอดระดับเอกสาร เช่น grand_total, vat, wht, fee · หรือ line.<key> เมื่อ perLine */
  readonly amount: string;
  /** สร้าง 1 บรรทัดต่อบรรทัดเอกสาร (รวมตามบัญชีภายหลัง) */
  readonly perLine?: boolean;
  readonly memo?: string;
}

export interface RuleDefinition {
  readonly code: string; // เช่น Service[IV]
  readonly docType: string;
  readonly name: string;
  readonly book: 'SJ' | 'PJ' | 'RJ' | 'PV' | 'GJ';
  /** สถานะชำระเมื่อลง (ScreenFormula): open = ลูกหนี้/เจ้าหนี้ค้าง · paid = ชำระแล้ว */
  readonly settlement?: 'open' | 'paid';
  readonly lines: readonly RuleLine[];
}

export interface PostingLineInput {
  readonly amounts: Readonly<Record<string, MoneyString | undefined>>;
  readonly account?: string;
  readonly productAccount?: string;
}

export interface PostingInput {
  readonly docType: string;
  readonly amounts: Readonly<Record<string, MoneyString | undefined>>;
  readonly lines?: readonly PostingLineInput[];
  readonly contact?: { readonly id?: string; readonly arAccount?: string; readonly apAccount?: string };
  /** บัญชีที่ผู้ใช้เลือกในเอกสาร เช่น input.cash = บัญชีธนาคาร/เช็ครับที่รับเงินเข้า */
  readonly accounts?: Readonly<Record<string, string | undefined>>;
}

export class PostingError extends Error {}

function resolveAccount(r: AccountResolver, input: PostingInput, line: PostingLineInput | undefined, ruleCode: string): string {
  for (const src of r.from ?? []) {
    let v: string | undefined;
    if (src === 'line') v = line?.account;
    else if (src === 'product') v = line?.productAccount;
    else if (src === 'contact.ar') v = input.contact?.arAccount;
    else if (src === 'contact.ap') v = input.contact?.apAccount;
    else v = input.accounts?.[src.slice('input.'.length)];
    if (v) {
      if (!isAccountCode(v)) throw new PostingError(`${ruleCode}: บัญชีจาก ${src} ไม่ถูกต้อง "${v}"`);
      return v;
    }
  }
  if (r.default) return r.default;
  throw new PostingError(`${ruleCode}: หาบัญชีไม่ได้ (${(r.from ?? []).join(' → ') || 'ไม่มีแหล่ง'}) และสูตรไม่มีค่าตั้งต้น — ห้ามเดา`);
}

/** รวมบรรทัดฝั่งเดียวกัน-บัญชีเดียวกัน (คงลำดับที่พบครั้งแรก) · ตัดบรรทัดศูนย์ */
function consolidate(lines: JournalLine[]): JournalLine[] {
  const out: JournalLine[] = [];
  for (const l of lines) {
    const hit = out.findIndex((o) => o.side === l.side && o.account === l.account && o.contactId === l.contactId);
    if (hit >= 0) out[hit] = { ...out[hit]!, amount: out[hit]!.amount.plus(l.amount) };
    else out.push(l);
  }
  return out.filter((l) => !l.amount.isZero());
}

export function post(rule: RuleDefinition, input: PostingInput): JournalLine[] {
  if (rule.docType !== input.docType) throw new PostingError(`สูตร ${rule.code} ใช้กับ ${rule.docType} ไม่ใช่ ${input.docType}`);
  const raw: JournalLine[] = [];
  const contactFor = (src: AccountResolver) =>
    src.from?.some((s) => s === 'contact.ar' || s === 'contact.ap') && input.contact?.id ? { contactId: input.contact.id } : {};
  for (const rl of rule.lines) {
    if (rl.perLine) {
      const key = rl.amount.replace(/^line\./u, '');
      for (const ln of input.lines ?? []) {
        const v = ln.amounts[key];
        if (v === undefined) continue;
        raw.push({ side: rl.side, account: resolveAccount(rl.account, input, ln, rule.code), amount: Money.of(v), ...(rl.memo ? { memo: rl.memo } : {}) });
      }
    } else {
      const v = input.amounts[rl.amount];
      if (v === undefined) continue;
      const amount = Money.of(v);
      if (amount.isNegative()) throw new PostingError(`${rule.code}: ยอด ${rl.amount} ติดลบ`);
      raw.push({ side: rl.side, account: resolveAccount(rl.account, input, undefined, rule.code), amount, ...contactFor(rl.account), ...(rl.memo ? { memo: rl.memo } : {}) });
    }
  }
  const lines = consolidate(raw);
  assertBalanced(lines);
  return lines;
}
