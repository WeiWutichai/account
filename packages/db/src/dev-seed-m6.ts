// dev seed (DEV ONLY) M6: ทะเบียนทรัพย์สิน · statement ธนาคารตัวอย่าง · สถานะงวดตาม fixtures period_close_2569 — หน้าจอ M6 แสดงตามแบบร่าง
import type { Db } from './index.ts';
import { autoMatch, closePeriod, importStatement, saveAsset } from './close-ops.ts';

type Fx = {
  fixed_assets: Record<string, string | number>[];
  company: { bank_accounts: { account: string; recon_2569_11?: { interest?: { gross: string; net: string } } }[] };
  period_close_2569: { rows: { period: string; status: string }[] };
};
const ce = (be: string) => `${Number(be.slice(0, 4)) - 543}${be.slice(4)}`;
// บัญชีค่าเสื่อม/ค่าเสื่อมสะสมตามหมวด (ผังบัญชีใน fixtures)
const ACCUM: Record<string, string> = { '1510100': '1510190', '1520100': '1520190', '1530100': '1530190', '1540100': '1540190' };
const EXPENSE: Record<string, string> = { '1510100': '5150100', '1520100': '5150200', '1530100': '5150300', '1540100': '5150300' };
const owner = { userId: null, role: 'owner' as const };

export async function seedM6(db: Db, companyId: string, fx: Fx): Promise<string[]> {
  for (const a of fx.fixed_assets) {
    const acc = String(a.account);
    // ค่าเสื่อมสะสมยกมา (ทะเบียนจากระบบเดิม) ณ สิ้น ต.ค. 2569 ถ้ามีใน fixtures
    const opening = a.accum_2569_10 ? String(a.accum_2569_10) : null;
    await saveAsset(db, companyId, { code: String(a.code), name: String(a.name ?? a.code), assetAccount: acc, accumAccount: String(a.accum ?? ACCUM[acc]), expenseAccount: String(a.expense ?? EXPENSE[acc]),
      startDate: ce(String(a.start)), lifeYears: String(a.life_years), cost: String(a.cost) as never, salvage: String(a.salvage ?? '1.00') as never,
      ...(opening ? { openingAccum: opening as never, openingAccumDate: '2026-10-31' } : {}) });
  }
  // statement ออมทรัพย์ พ.ย. (รายการที่ระบุใน fixtures: เงินเข้า RV2611-0021 · โอนรอบจ่าย 28/11 · ดอกเบี้ย · ค่าธรรมเนียม)
  // TODO(Wei): fixtures ไม่มี statement ทั้งเดือน — ใส่เฉพาะรายการที่ระบุ ยอดคงเหลือ/ผลต่าง 21,250.00 จึงยังไม่ตรงแบบร่าง
  const interest = fx.company.bank_accounts.find((b) => b.account === '1100100')?.recon_2569_11?.interest;
  const csv = ['วันที่,รายการ,จำนวนเงิน', '27/11/2569,TRF 2711 ref 889120 SIAM PLASTIC CO,1517277.20', '28/11/2569,BULK 2811 batch 0042,-895500.00',
    ...(interest ? [`30/11/2569,ดอกเบี้ยรับ,${interest.net}`] : []), '30/11/2569,ค่าธรรมเนียม,-20.00'].join('\n');
  const { parseStatementCsv } = await import('./close-ops.ts');
  await importStatement(db, companyId, '1100100', parseStatementCsv(csv), 'dev-seed-2569-11');
  const m = await autoMatch(db, companyId, '1100100');
  // สถานะงวดตาม fixtures (ปิดเรียงลำดับ)
  for (const r of fx.period_close_2569.rows) {
    const months = r.period.includes('..') ? (() => { const [a, b] = r.period.slice(5).split('..').map(Number) as [number, number]; return Array.from({ length: b - a + 1 }, (_, i) => a + i); })() : [Number(r.period.slice(5))];
    for (const p of months) if (r.status === 'soft_closed' || r.status === 'hard_closed') await closePeriod(db, companyId, owner, { fiscalYear: 2569, periodNo: p, to: r.status });
  }
  return [`ทรัพย์สิน ${fx.fixed_assets.length} รายการ · statement จับคู่อัตโนมัติ ${m.matched} รายการ · สถานะงวดตาม fixtures`];
}
