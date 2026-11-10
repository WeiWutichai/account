// API หลายสกุลเงิน + สาขา (Phase 2A FXB · docs/technical-plan-P2A.md) — logic อยู่ใน @innovera/db/fx
// ยังไม่มีแบบร่าง UI ของหน้าจอเหล่านี้ (backend ก่อน) · เอกสาร/รับ/จ่ายสกุลต่างประเทศใช้ route เดิม + currency/fxRate/branchCode
import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req, UnprocessableEntityException } from '@nestjs/common';
import type { Db } from '@innovera/db';
import {
  companyModules, deleteRate, disableModule, enableModule, fxbSettings, listBranches, listCurrencies, listRates, rateOn, revaluationPreview, revaluationRuns, runRevaluation, saveBranch, saveCurrency, saveRate, setFxbSetting,
  type FxbModule, type RateSource,
} from '@innovera/db/fx';
import type { Request } from 'express';
import { actorIdOf, companyOf, Need, roleOf } from './context.js';
import { DB } from './db.js';

const actor = (req: Request) => ({ userId: actorIdOf(req), role: roleOf(req) });
const MODULES: readonly FxbModule[] = ['multi_currency', 'branches'];
const date = (s?: string) => { if (!s || !/^\d{4}-\d{2}-\d{2}$/u.test(s)) throw new UnprocessableEntityException('ระบุวันที่เป็น YYYY-MM-DD'); return s; };
const period = (y: string, n: string) => {
  const fiscalYear = Number(y);
  const periodNo = Number(n);
  if (!Number.isInteger(fiscalYear) || !Number.isInteger(periodNo)) throw new UnprocessableEntityException('ระบุปีบัญชี (พ.ศ.) และงวดเป็นตัวเลข');
  return { fiscalYear, periodNo };
};

@Controller('v1')
export class FxController {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ---------- โมดูล + ค่าตั้ง (รอผู้สอบบัญชี) ----------
  /** เปิดโมดูล: multi_currency (สร้างบัญชี 4910100/5920100) · branches (สร้างสำนักงานใหญ่ 00000) */
  @Need('settings', 'write') @Post('modules/:module/enable')
  async enable(@Req() req: Request, @Param('module') m: string) {
    if (!MODULES.includes(m as FxbModule)) throw new UnprocessableEntityException(`โมดูลต้องเป็น ${MODULES.join(' / ')}`);
    await enableModule(this.db, companyOf(req), m as FxbModule);
    return { ok: true };
  }
  /** ปิดโมดูล multi_currency / branches (ได้เมื่อยังไม่มีเอกสารที่ใช้โมดูล · ข้อมูลเดิมคงอยู่) */
  @Need('settings', 'write') @Post('modules/:module/disable')
  async disable(@Req() req: Request, @Param('module') m: string) {
    if (!MODULES.includes(m as FxbModule)) throw new UnprocessableEntityException(`โมดูลต้องเป็น ${MODULES.join(' / ')}`);
    await disableModule(this.db, companyOf(req), m as FxbModule);
    return { ok: true };
  }
  /** สถานะโมดูลทั้งหมดของบริษัท (inventory · multi_currency · branches · software) — ทุกบทบาทอ่านได้ (ฟอร์มแสดงช่องของโมดูลที่เปิด) */
  @Get('modules')
  modules(@Req() req: Request) { return companyModules(this.db, companyOf(req)); }
  /** fx.rate_source · fx.revalue_period_end · branch.numbering · branch.vat_filing (ทุกค่า "รอยืนยัน" — pendingAuditor) */
  @Need('settings', 'read') @Get('fx/settings')
  settings(@Req() req: Request) { return fxbSettings(this.db, companyOf(req)); }
  @Need('settings', 'write') @Put('fx/settings/:key')
  async setSetting(@Req() req: Request, @Param('key') key: string, @Body() b: { value: unknown }) {
    await setFxbSetting(this.db, companyOf(req), key, b?.value);
    return { ok: true };
  }

  // ---------- สกุลเงิน / อัตรา ----------
  @Need('journal', 'read') @Get('fx/currencies')
  currencies(@Req() req: Request) { return listCurrencies(this.db, companyOf(req)); }
  @Need('journal', 'write') @Put('fx/currencies/:code')
  async saveCurrency(@Req() req: Request, @Param('code') code: string, @Body() b: { name: string; decimals?: number; active?: boolean }) {
    await saveCurrency(this.db, companyOf(req), { ...b, code: code.toUpperCase() });
    return { ok: true };
  }
  @Need('journal', 'read') @Get('fx/rates')
  rates(@Req() req: Request, @Query('currency') currency?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return listRates(this.db, companyOf(req), { ...(currency ? { currency } : {}), ...(from ? { from: date(from) } : {}), ...(to ? { to: date(to) } : {}) });
  }
  /** อัตรา ณ วันที่ตาม fx.rate_source (ล่าสุดที่ไม่เกินวันนั้น) */
  @Need('journal', 'read') @Get('fx/rates/on')
  async rateOn(@Req() req: Request, @Query('currency') currency: string, @Query('date') d: string) {
    return { currency, date: date(d), rate: await rateOn(this.db, companyOf(req), currency, date(d)) };
  }
  /** กรอกอัตรา (บาทต่อ 1 หน่วย · ไม่ดึงจากภายนอก) — วันที่+สกุล+แหล่งเดิม = แก้ไข */
  @Need('journal', 'write') @Put('fx/rates')
  async saveRate(@Req() req: Request, @Body() b: { currency: string; date: string; rate: string; source?: RateSource }) {
    await saveRate(this.db, companyOf(req), actorIdOf(req), { ...b, date: date(b?.date) });
    return { ok: true };
  }
  @Need('journal', 'write') @Delete('fx/rates/:currency/:date')
  async deleteRate(@Req() req: Request, @Param('currency') currency: string, @Param('date') d: string, @Query('source') source?: RateSource) {
    await deleteRate(this.db, companyOf(req), { currency, date: date(d), ...(source ? { source } : {}) });
    return { ok: true };
  }

  // ---------- ปรับมูลค่าสิ้นงวด (fx.revalue_period_end) ----------
  @Need('journal', 'read') @Get('fx/revaluation')
  runs(@Req() req: Request, @Query('year') year: string) { return revaluationRuns(this.db, companyOf(req), Number(year)); }
  @Need('journal', 'read') @Get('fx/revaluation/:year/:no/preview')
  preview(@Req() req: Request, @Param('year') year: string, @Param('no') no: string) { return revaluationPreview(this.db, companyOf(req), period(year, no)); }
  /** ลงบัญชีปรับมูลค่าสิ้นงวด + กลับรายการวันแรกของงวดถัดไป (ครั้งเดียวต่องวด) */
  @Need('journal', 'post') @Post('fx/revaluation/:year/:no')
  revalue(@Req() req: Request, @Param('year') year: string, @Param('no') no: string) { return runRevaluation(this.db, companyOf(req), actor(req), period(year, no)); }

  // ---------- สาขา ----------
  @Need('journal', 'read') @Get('branches')
  branches(@Req() req: Request) { return listBranches(this.db, companyOf(req)); }
  @Need('journal', 'write') @Put('branches/:code')
  async saveBranch(@Req() req: Request, @Param('code') code: string, @Body() b: { name: string; address?: string | null; taxId?: string | null; filesSeparately?: boolean; active?: boolean }) {
    await saveBranch(this.db, companyOf(req), { ...b, code });
    return { ok: true };
  }
}
