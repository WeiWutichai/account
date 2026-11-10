// API ของ Phase 2A SWT: สัญญา/รายได้รับล่วงหน้า · ภ.พ.36 / ภ.ง.ด.54 · สินทรัพย์ไม่มีตัวตน — logic อยู่ใน @innovera/db/contract + @innovera/db/foreign-tax
// backend อย่างเดียว: ยังไม่มีแบบร่าง .dc.html ของหน้าจอเหล่านี้ (docs/technical-plan-P2A.md กติกาข้อ 1)
import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Put, Query, Req, UnprocessableEntityException } from '@nestjs/common';
import type { Db } from '@innovera/db';
import { cancelContract, completeMilestone, contractMetrics, getContract, listContracts, recognitionRuns, recordUsage, runBilling, runRevenueRecognition, saveContract, saveIntangibleAsset,
  setSoftwareModule, swtSettings, SWT_SETTINGS, voidRevenueRecognition, type ContractInput, type IntangibleInput, type UsageInput } from '@innovera/db/contract';
import { filePp36, foreignContacts, pp36Report, setContactCountry, SWT_TAX_KEYS } from '@innovera/db/foreign-tax';
import { setCompanySetting } from '@innovera/db/purchase';
import { fileTax, pndReport } from '@innovera/db/reports';
import { PND54_INCOME_TYPES, validTreatyRates } from '@innovera/tax-th';
import type { Request } from 'express';
import { actorIdOf, companyOf, Need, roleOf } from './context.js';
import { DB } from './db.js';

const actor = (req: Request) => ({ userId: actorIdOf(req), role: roleOf(req) });
const ym = (s?: string) => { if (!s || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(s)) throw new UnprocessableEntityException('ระบุเดือนเป็น YYYY-MM'); return s; };
const date = (s?: string) => { if (!s || !/^\d{4}-\d{2}-\d{2}$/u.test(s)) throw new UnprocessableEntityException('ระบุวันที่เป็น YYYY-MM-DD'); return s; };
const today = (): string => process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10);

/** ตรวจรูปค่าตั้ง SWT (รอผู้สอบบัญชี) ก่อนบันทึก */
function validSwtSetting(key: string, v: unknown): boolean {
  switch (key) {
    case 'revenue.standard': return v === 'npae' || v === 'tfrs';
    case 'revenue.ssp_allocation': return v === 'contract_price' || v === 'relative_ssp';
    case 'revenue.vat_point_subscription': return v === 'on_payment' || v === 'on_invoice';
    case 'tax.pp36.enabled': case 'tax.pnd54.gross_up': case 'asset.intangible.capitalize_dev': return typeof v === 'boolean';
    case 'tax.pnd54.treaty_rates': return validTreatyRates(v);
    case SWT_TAX_KEYS.grossUpAccount: return v === null || (typeof v === 'string' && /^\d{7}$/u.test(v));
    default: return false;
  }
}

@Controller('v1')
export class ContractController {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ---------- โมดูล + ค่าตั้ง ----------
  @Need('settings', 'write') @Put('modules/software')
  module(@Req() req: Request, @Body() b: { on: boolean }) { return setSoftwareModule(this.db, companyOf(req), b.on === true, actorIdOf(req)); }
  @Need('settings', 'read') @Get('swt/settings')
  settings(@Req() req: Request) { return swtSettings(this.db, companyOf(req)); }
  /** ค่าตั้งที่รอผู้สอบบัญชี (revenue.* · tax.pp36.* · tax.pnd54.* · asset.intangible.*) */
  @Need('settings', 'write') @Put('swt/settings/:key')
  async setSetting(@Req() req: Request, @Param('key') key: string, @Body() b: { value: unknown }) {
    if (!(key in SWT_SETTINGS) && key !== SWT_TAX_KEYS.grossUpAccount) throw new UnprocessableEntityException('ไม่รู้จักค่าตั้งนี้');
    if (!validSwtSetting(key, b.value)) throw new UnprocessableEntityException('รูปแบบค่าตั้งไม่ถูกต้อง');
    await setCompanySetting(this.db, companyOf(req), key, b.value);
    return { ok: true };
  }

  // ---------- สัญญา ----------
  @Need('sales', 'read') @Get('contracts')
  list(@Req() req: Request) { return listContracts(this.db, companyOf(req)); }
  @Need('sales', 'read') @Get('contracts/:id')
  async get(@Req() req: Request, @Param('id') id: string) {
    const c = await getContract(this.db, companyOf(req), id);
    if (!c) throw new NotFoundException('ไม่พบสัญญา');
    return c;
  }
  @Need('sales', 'write') @Post('contracts')
  async create(@Req() req: Request, @Body() b: ContractInput) { return { id: await saveContract(this.db, companyOf(req), actor(req), b) }; }
  @Need('sales', 'write') @Put('contracts/:id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() b: ContractInput) { return { id: await saveContract(this.db, companyOf(req), actor(req), b, id) }; }
  @Need('sales', 'write') @Post('contracts/:id/cancel')
  async cancel(@Req() req: Request, @Param('id') id: string, @Body() b: { date?: string; reason: string }) {
    await cancelContract(this.db, companyOf(req), actor(req), id, { date: b.date ?? today(), reason: b.reason });
    return { ok: true };
  }
  @Need('sales', 'write') @Post('contract-lines/:id/milestone')
  async milestone(@Req() req: Request, @Param('id') id: string, @Body() b: { date?: string }) {
    await completeMilestone(this.db, companyOf(req), actor(req), id, b.date ?? today());
    return { ok: true };
  }
  @Need('sales', 'write') @Post('contracts/usage')
  usage(@Req() req: Request, @Body() b: UsageInput) { return recordUsage(this.db, companyOf(req), b); }
  /** รอบบิล → ใบแจ้งหนี้ "ร่าง" (ผู้ใช้ตรวจและอนุมัติเอง) */
  @Need('sales', 'write') @Post('contracts/billing-run')
  billing(@Req() req: Request, @Body() b: { asOf?: string; contractId?: string }) {
    return runBilling(this.db, companyOf(req), actor(req), { asOf: b.asOf ?? today(), ...(b.contractId ? { contractId: b.contractId } : {}) });
  }
  @Need('reports', 'read') @Get('contracts-metrics')
  metrics(@Req() req: Request, @Query('asOf') asOf?: string, @Query('month') month?: string) {
    return contractMetrics(this.db, companyOf(req), { asOf: asOf ? date(asOf) : today(), ...(month ? { month: ym(month) } : {}) });
  }

  // ---------- รับรู้รายได้รายงวด (เหมือนค่าเสื่อม) ----------
  @Need('period', 'read') @Get('revenue-recognition')
  runs(@Req() req: Request, @Query('year') year: string) { return recognitionRuns(this.db, companyOf(req), Number(year)); }
  @Need('journal', 'post') @Post('revenue-recognition/:year/:no')
  recognize(@Req() req: Request, @Param('year') year: string, @Param('no') no: string) {
    return runRevenueRecognition(this.db, companyOf(req), actor(req), { fiscalYear: Number(year), periodNo: Number(no) });
  }
  @Need('void', 'void') @Post('revenue-recognition/:year/:no/void')
  voidRecognition(@Req() req: Request, @Param('year') year: string, @Param('no') no: string, @Body() b: { reason: string; date?: string }) {
    return voidRevenueRecognition(this.db, companyOf(req), actor(req), { fiscalYear: Number(year), periodNo: Number(no), reason: b.reason, ...(b.date ? { date: date(b.date) } : {}) });
  }

  // ---------- ภ.พ.36 / ภ.ง.ด.54 ----------
  @Need('purchase', 'read') @Get('pnd54-types')
  pnd54Types() { return PND54_INCOME_TYPES; }
  /** ผู้ติดต่อต่างประเทศ + ประเทศ (หน้าจอชั่วคราว /tax/foreign) */
  @Need('purchase', 'read') @Get('foreign-contacts')
  foreign(@Req() req: Request) { return foreignContacts(this.db, companyOf(req)); }
  @Need('purchase', 'write') @Put('contacts/:id/country')
  async country(@Req() req: Request, @Param('id') id: string, @Body() b: { country: string | null }) {
    await setContactCountry(this.db, companyOf(req), actorIdOf(req), id, b.country ?? null);
    return { ok: true };
  }
  @Need('reports', 'read') @Get('tax/pp36')
  pp36(@Req() req: Request, @Query('month') m: string) { return pp36Report(this.db, companyOf(req), ym(m)); }
  /** บันทึกยื่น/ชำระ ภ.พ.36 + โอน 1170200 → 1170100 (ภาษีซื้อเดือนที่ยื่น) */
  @Need('journal', 'post') @Post('tax/pp36/:month/filed')
  pp36Filed(@Req() req: Request, @Param('month') m: string, @Body() b: { filedAt?: string; payFrom: string; referenceNo?: string | null }) {
    if (!b.payFrom) throw new UnprocessableEntityException('ระบุบัญชีที่จ่ายภาษี');
    return filePp36(this.db, companyOf(req), actor(req), { month: ym(m), filedAt: b.filedAt ?? today(), payFrom: b.payFrom, referenceNo: b.referenceNo ?? null });
  }
  @Need('reports', 'read') @Get('tax/pnd54')
  pnd54(@Req() req: Request, @Query('month') m: string) { return pndReport(this.db, companyOf(req), ym(m), '54'); }
  /** บันทึกว่ายื่น ภ.ง.ด.54 แล้ว — ไม่มี JV (2150600 ล้างตอนจ่ายนำส่ง เหมือน ภ.ง.ด.3/53) */
  @Need('journal', 'post') @Post('tax/pnd54/:month/filed')
  pnd54Filed(@Req() req: Request, @Param('month') m: string, @Body() b: { filedAt?: string; referenceNo?: string | null; additional?: boolean } = {}) {
    return fileTax(this.db, companyOf(req), actor(req), { form: 'pnd54', month: ym(m), filedAt: b.filedAt ?? today(), referenceNo: b.referenceNo ?? null, additional: b.additional ?? false });
  }

  // ---------- สินทรัพย์ไม่มีตัวตน ----------
  @Need('journal', 'post') @Post('intangible-assets')
  async intangible(@Req() req: Request, @Body() b: IntangibleInput) {
    await saveIntangibleAsset(this.db, companyOf(req), b);
    return { ok: true };
  }
}
