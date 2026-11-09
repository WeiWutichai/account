// pnpm db:seed — บริษัทตัวอย่างสำหรับ dev: ผังบัญชี/งวด/คู่ค้า/สินค้าจาก fixtures + ผ่านรายการ expected_journal ของเอกสารใน fixtures
// ใช้ DEV_COMPANY_ID คงที่ (เว็บ dev ใช้ค่าเดียวกัน) · รันซ้ำได้: ถ้ามีบริษัทแล้วเติมเฉพาะข้อมูลตั้งต้นที่ขาด
import { fromTuples, type JournalLineTuple } from '@innovera/ledger';
import { createDb } from './index.ts';
import { postJournal } from './ledger-service.ts';
import { loadFixtures, seedCompany } from './seed.ts';
import { SEEDED_SALES_TYPES, seedCheques, seedSalesDocuments } from './dev-seed-sales.ts';
import { SEEDED_PURCHASE_TYPES, seedPurchaseDocuments } from './dev-seed-purchase.ts';
import { seedM6 } from './dev-seed-m6.ts';

const COMPANY_ID = process.env.DEV_COMPANY_ID ?? '00000000-0000-4000-8000-000000000001';
const ORG_ID = '00000000-0000-4000-8000-0000000000aa';
const db = createDb(process.env.DATABASE_URL ?? 'postgres://app:app@localhost:56432/innovera', 2);

const exists = await db.withPublic((tx) => tx.selectFrom('public.company').select('id').where('id', '=', COMPANY_ID).executeTakeFirst());
if (exists) {
  // seedCompany รันซ้ำได้ (upsert) — เติมสิ่งที่ migration ใหม่เพิ่ม เช่น งวด 0 · ไม่ลงรายการตัวอย่างซ้ำ
  console.log(`มีบริษัท dev แล้ว (${COMPANY_ID}) — เติมข้อมูลตั้งต้นที่ขาด:`, await seedCompany(db, COMPANY_ID));
} else {
  await db.withPublic(async (tx) => {
    await tx.insertInto('public.organization').values({ id: ORG_ID, name: 'Innovera Group' } as never).onConflict((oc) => oc.column('id').doNothing()).execute();
    await tx.insertInto('public.company').values({ id: COMPANY_ID, org_id: ORG_ID, name_th: 'บริษัท [ชื่อบริษัท] จำกัด', name_en: '[Company Name] Co., Ltd.' /* fixtures company */, tax_id: '0105xxxxxxxxx', db_dsn: null } as never).execute();
  });
  const r = await seedCompany(db, COMPANY_ID);
  console.log('seed:', r);
  const fx = loadFixtures() as unknown as { documents: Record<string, { type: string; date?: string; expected_journal?: JournalLineTuple[] }> };
  // เอกสารขาย/รับเงิน: สร้างเป็นเอกสารจริงผ่าน sales service (M4) · ประเภทอื่นยังลง journal ตาม expected_journal จนกว่าจะมีโมดูล (M5+)
  for (const l of await seedSalesDocuments(db, COMPANY_ID, fx.documents as never, (fx as unknown as { cheques_received: never }).cheques_received)) console.log(l);
  for (const l of await seedCheques(db, COMPANY_ID)) console.log(l);
  for (const l of await seedPurchaseDocuments(db, COMPANY_ID, { ...fx.documents, __petty: (fx as unknown as { petty_cash: unknown }).petty_cash } as never)) console.log(l);
  let n = 0;
  for (const [no, d] of Object.entries(fx.documents)) {
    if (!d.expected_journal || !d.date || SEEDED_SALES_TYPES.includes(d.type) || SEEDED_PURCHASE_TYPES.includes(d.type)) continue;
    const ce = `${Number(d.date.slice(0, 4)) - 543}${d.date.slice(4)}`;
    const book = no.startsWith('IV') || no.startsWith('CN') ? 'SJ' : no.startsWith('RV') ? 'RJ' : no.startsWith('PV') || no.startsWith('EXP') ? 'PV' : no.startsWith('AP') || no.startsWith('CNR') ? 'PJ' : 'GJ';
    try {
      await postJournal(db, COMPANY_ID, { date: ce, lines: fromTuples(d.expected_journal), role: 'accounting_manager', book, prefix: book === 'GJ' ? 'JV' : book, description: no });
      n++;
    } catch (e) {
      console.warn(`ข้าม ${no}: ${(e as Error).message}`);
    }
  }
  console.log(`ผ่านรายการตัวอย่าง ${n} ชุด`);
  for (const l of await seedM6(db, COMPANY_ID, fx as never)) console.log(l);
}
await db.close();
