// API ของธนาคาร + ภาษี + ปิดงวด + ทรัพย์สิน + รายงาน (M6 · docs/technical-plan-M6.md)
import { Body, Controller, Get, Header, Inject, Param, Post, Put, Query, Req, Res, UnprocessableEntityException } from '@nestjs/common';
import type { Db } from '@innovera/db';
import { autoMatch, closePeriod, closeReconciliation, depreciationFor, importStatement, matchManually, parseStatement, periodStatus, reconciliation, reopenPeriod, runDepreciation, saveAsset, yearEnd, type AssetInput } from '@innovera/db/close-ops';
import { aging, financialStatements, pndReport, rdPrepTxt, reconChecks, vatReports } from '@innovera/db/reports';
import type { Request, Response } from 'express';
import { companyOf, Need, roleOf, userOf } from './context.js';
import { DB } from './db.js';

const actor = (req: Request) => ({ userId: userOf(req).userId === 'dev' ? null : userOf(req).userId, role: roleOf(req) });
const ym = (s?: string) => { if (!s || !/^\d{4}-\d{2}$/u.test(s)) throw new UnprocessableEntityException('ระบุเดือนเป็น YYYY-MM'); return s; };

@Controller('v1')
export class M6Controller {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ---------- ภาษี ----------
  @Need('reports', 'read') @Get('tax/vat')
  vat(@Req() req: Request, @Query('month') m: string) { return vatReports(this.db, companyOf(req), ym(m)); }
  @Need('reports', 'read') @Get('tax/pnd')
  pnd(@Req() req: Request, @Query('month') m: string, @Query('form') form: '3' | '53') { return pndReport(this.db, companyOf(req), ym(m), form === '3' ? '3' : '53'); }
  /** ไฟล์ RD Prep — TODO(Wei) T11: รูปแบบรอตรวจกับ spec จริง */
  @Need('reports', 'read') @Get('tax/pnd/rdprep')
  async rdprep(@Req() req: Request, @Res() res: Response, @Query('month') m: string, @Query('form') form: '3' | '53') {
    const r = await pndReport(this.db, companyOf(req), ym(m), form === '3' ? '3' : '53');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="PND${r.pnd}_${Number(m.slice(0, 4)) + 543}_${m.slice(5)}.txt"`);
    res.send(rdPrepTxt(r));
  }
  @Need('reports', 'read') @Get('reports/recon')
  recon(@Req() req: Request, @Query('month') m: string) { return reconChecks(this.db, companyOf(req), ym(m)); }
  @Need('reports', 'read') @Get('reports/aging')
  aging(@Req() req: Request, @Query('asOf') asOf: string, @Query('side') side: 'AR' | 'AP') { return aging(this.db, companyOf(req), asOf, side === 'AP' ? 'AP' : 'AR'); }
  @Need('reports', 'read') @Get('reports/statements')
  statements(@Req() req: Request, @Query('year') year: string, @Query('period') period: string) { return financialStatements(this.db, companyOf(req), { fiscalYear: Number(year), upToPeriod: Number(period) }); }

  // ---------- ปิดงวด ----------
  @Need('period', 'read') @Get('periods')
  periods(@Req() req: Request, @Query('year') year: string) { return periodStatus(this.db, companyOf(req), Number(year)); }
  @Need('period', 'post') @Post('periods/:year/:no/close')
  async close(@Req() req: Request, @Param('year') year: string, @Param('no') no: string, @Body() b: { to: 'soft_closed' | 'hard_closed' }) {
    await closePeriod(this.db, companyOf(req), actor(req), { fiscalYear: Number(year), periodNo: Number(no), to: b.to });
    return { ok: true };
  }
  @Need('period', 'post') @Post('periods/:year/:no/reopen')
  async reopen(@Req() req: Request, @Param('year') year: string, @Param('no') no: string, @Body() b: { reason: string }) {
    await reopenPeriod(this.db, companyOf(req), actor(req), { fiscalYear: Number(year), periodNo: Number(no), reason: b.reason });
    return { ok: true };
  }
  @Need('period', 'post') @Post('periods/:year/year-end')
  yearEnd(@Req() req: Request, @Param('year') year: string) { return yearEnd(this.db, companyOf(req), actor(req), Number(year)); }

  // ---------- ทรัพย์สิน ----------
  @Need('journal', 'read') @Get('assets')
  async assets(@Req() req: Request, @Query('month') m: string) { return depreciationFor(this.db, companyOf(req), ym(m)); }
  @Need('journal', 'write') @Put('assets/:code')
  async saveAsset(@Req() req: Request, @Param('code') code: string, @Body() b: Omit<AssetInput, 'code'>) { await saveAsset(this.db, companyOf(req), { ...b, code }); return { ok: true }; }
  @Need('journal', 'post') @Post('assets/depreciation/:year/:no')
  dep(@Req() req: Request, @Param('year') year: string, @Param('no') no: string) { return runDepreciation(this.db, companyOf(req), actor(req), { fiscalYear: Number(year), periodNo: Number(no) }); }

  // ---------- ธนาคาร ----------
  @Need('finance', 'write') @Post('bank/:account/statement') @Header('Cache-Control', 'no-store')
  async importCsv(@Req() req: Request, @Param('account') account: string, @Body() b: { csv: string; batch?: string }) {
    const rows = parseStatement(b.csv); // CSV หรือ OFX (ตรวจจากเนื้อไฟล์)
    const r = await importStatement(this.db, companyOf(req), account, rows, b.batch ?? new Date().toISOString());
    return { ...r, ...(await autoMatch(this.db, companyOf(req), account)) };
  }
  @Need('finance', 'write') @Post('bank/:account/auto-match')
  match(@Req() req: Request, @Param('account') account: string) { return autoMatch(this.db, companyOf(req), account); }
  /** journalIds = จับคู่ 1 ต่อหลาย ([] = ยกเลิกจับคู่) · journalId = 1 ใบ · journalId null = พักไว้ */
  @Need('finance', 'write') @Put('bank/lines/:id')
  async manual(@Req() req: Request, @Param('id') id: string, @Body() b: { journalId?: string | null; journalIds?: string[] }) {
    await matchManually(this.db, companyOf(req), id, Array.isArray(b.journalIds) ? b.journalIds : b.journalId ? [b.journalId] : null);
    return { ok: true };
  }
  /** "ปิดกระทบยอดเดือนนี้" — ผลต่างต้องเป็น 0.00 · ล็อกรายการธนาคารของเดือน */
  @Need('period', 'post') @Post('bank/:account/close')
  closeRecon(@Req() req: Request, @Param('account') account: string, @Body() b: { month: string }) { return closeReconciliation(this.db, companyOf(req), actor(req), account, ym(b.month)); }
  @Need('finance', 'read') @Get('bank/:account/reconciliation')
  rec(@Req() req: Request, @Param('account') account: string, @Query('asOf') asOf: string) { return reconciliation(this.db, companyOf(req), account, asOf); }
}
