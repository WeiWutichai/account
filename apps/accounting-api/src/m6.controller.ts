// API ของธนาคาร + ภาษี + ปิดงวด + ทรัพย์สิน + รายงาน (M6 · docs/technical-plan-M6.md)
import { Body, Controller, Get, Header, Inject, Param, Post, Put, Query, Req, Res, UnprocessableEntityException } from '@nestjs/common';
import type { Db } from '@innovera/db';
import { autoMatch, closePeriod, closeReconciliation, depreciationFor, depreciationRuns, disposeAsset, importStatement, matchManually, openFiscalYear, parseStatement, periodStatus, reconciliation, reopenPeriod, reviewAccruals, runDepreciation, saveAsset, yearEnd, type AssetInput, type DisposeInput } from '@innovera/db/close-ops';
import { aging, fileTax, financialStatements, pndReport, rdPrepTxt, reconChecks, taxFilings, vatReports } from '@innovera/db/reports';
import ExcelJS from 'exceljs';
import type { Request, Response } from 'express';
import { companyOf, Need, roleOf, userOf } from './context.js';
import { DB } from './db.js';

const actor = (req: Request) => ({ userId: userOf(req).userId === 'dev' ? null : userOf(req).userId, role: roleOf(req) });
const ym = (s?: string) => { if (!s || !/^\d{4}-\d{2}$/u.test(s)) throw new UnprocessableEntityException('ระบุเดือนเป็น YYYY-MM'); return s; };
const today = (): string => process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10);
/** ?month=YYYY-MM หรือ ?year=2569 (ปีบัญชี พ.ศ. "ปีบัญชี 2569 สะสม") */
const reconPeriod = (m?: string, y?: string) => { if (y && /^\d{4}$/u.test(y)) return y; return ym(m); };

@Controller('v1')
export class M6Controller {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ---------- ภาษี ----------
  @Need('reports', 'read') @Get('tax/vat')
  /** ?branch=00001 = เฉพาะสาขา (P2A FXB · ว่าง = ทุกสาขาเหมือนเดิม) */
  vat(@Req() req: Request, @Query('month') m: string, @Query('branch') branch?: string) { return vatReports(this.db, companyOf(req), ym(m), branch ? { branch } : {}); }
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
  /** บันทึกว่ายื่น ภ.พ.30 แล้ว + ลงบัญชีนำส่ง (postOnFiled) · additional = ยื่นเพิ่มเติม */
  @Need('journal', 'post') @Post('tax/pp30/:month/filed')
  pp30Filed(@Req() req: Request, @Param('month') m: string, @Body() b: { filedAt?: string; referenceNo?: string | null; additional?: boolean } = {}) {
    return fileTax(this.db, companyOf(req), actor(req), { form: 'pp30', month: ym(m), filedAt: b.filedAt ?? today(), referenceNo: b.referenceNo ?? null, additional: b.additional ?? false });
  }
  /** บันทึกว่ายื่น ภ.ง.ด.3/53 แล้ว — ไม่มี JV (2150300 ล้างตอนจ่ายนำส่ง) */
  @Need('journal', 'post') @Post('tax/pnd/:form/:month/filed')
  pndFiled(@Req() req: Request, @Param('form') form: string, @Param('month') m: string, @Body() b: { filedAt?: string; referenceNo?: string | null; additional?: boolean } = {}) {
    if (form !== '3' && form !== '53') throw new UnprocessableEntityException('แบบต้องเป็น 3 หรือ 53');
    return fileTax(this.db, companyOf(req), actor(req), { form: form === '3' ? 'pnd3' : 'pnd53', month: ym(m), filedAt: b.filedAt ?? today(), referenceNo: b.referenceNo ?? null, additional: b.additional ?? false });
  }
  @Need('reports', 'read') @Get('tax/filings')
  filings(@Req() req: Request, @Query('from') from: string, @Query('to') to: string) { return taxFilings(this.db, companyOf(req), { from: ym(from), to: ym(to) }); }
  @Need('reports', 'read') @Get('reports/recon')
  recon(@Req() req: Request, @Query('month') m?: string, @Query('year') y?: string) { return reconChecks(this.db, companyOf(req), reconPeriod(m, y)); }
  /** ScreenReconReport "ส่งออกรายงาน (PDF/Excel)" — Excel · TODO(Wei): PDF ยังไม่มีแบบร่างแบบพิมพ์รายงานตรวจ */
  @Need('reports', 'read') @Get('reports/recon/export')
  async reconExport(@Req() req: Request, @Res() res: Response, @Query('month') m?: string, @Query('year') y?: string) {
    const period = reconPeriod(m, y);
    const r = await reconChecks(this.db, companyOf(req), period);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('ตรวจความถูกต้อง');
    ws.addRow(['รายงานตรวจความถูกต้อง', period, `${r.from} – ${r.to}`]);
    ws.addRow(['จุดตรวจ', String(r.checks.length), 'ผ่าน', String(r.passed), 'ผลต่างต้องดู', String(r.toReview)]);
    ws.addRow([]);
    ws.addRow(['ด้าน', 'จุดตรวจ', 'จำนวน', 'ยอดตามเอกสาร/รายงาน', 'ยอดตาม GL', 'ผลต่าง', 'ผล', 'หมายเหตุ']);
    // ยอดเงินเป็นข้อความ 2 ตำแหน่ง (ไม่แปลงเป็น float · เหมือน export ผังบัญชี)
    for (const c of r.checks) ws.addRow([String(c.section), c.label, c.count ?? '', c.byDocs, c.byGl, c.diff, c.ok ? 'ผ่าน' : 'ต้องดู', c.note ?? '']);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="recon-${period}.xlsx"`);
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }
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
  @Need('period', 'post') @Post('periods/:year/:no/accrual-reviewed')
  async reviewed(@Req() req: Request, @Param('year') year: string, @Param('no') no: string) {
    await reviewAccruals(this.db, companyOf(req), actor(req), { fiscalYear: Number(year), periodNo: Number(no) });
    return { ok: true };
  }
  /** เปิดปีบัญชี (สร้างงวด 0–13) — owner/ผู้จัดการบัญชี · idempotent */
  @Need('period', 'post') @Post('periods/:year/open')
  openYear(@Req() req: Request, @Param('year') year: string) { return openFiscalYear(this.db, companyOf(req), actor(req), Number(year)); }
  @Need('period', 'post') @Post('periods/:year/year-end')
  yearEnd(@Req() req: Request, @Param('year') year: string) { return yearEnd(this.db, companyOf(req), actor(req), Number(year)); }

  // ---------- ทรัพย์สิน ----------
  @Need('journal', 'read') @Get('assets')
  async assets(@Req() req: Request, @Query('month') m: string) { return depreciationFor(this.db, companyOf(req), ym(m)); }
  @Need('journal', 'write') @Put('assets/:code')
  async saveAsset(@Req() req: Request, @Param('code') code: string, @Body() b: Omit<AssetInput, 'code'>) { await saveAsset(this.db, companyOf(req), { ...b, code }); return { ok: true }; }
  @Need('journal', 'read') @Get('assets/depreciation')
  runs(@Req() req: Request, @Query('year') year: string) { return depreciationRuns(this.db, companyOf(req), Number(year)); }
  /** ขาย/จำหน่ายทรัพย์สิน: ค่าเสื่อมถึงวันที่ขาย + JV ขาย (กำไร/ขาดทุน · ภาษีขายตาม vat ค่าตั้งต้น = บริษัทจด VAT) */
  @Need('journal', 'post') @Post('assets/:code/dispose')
  dispose(@Req() req: Request, @Param('code') code: string, @Body() b: DisposeInput) { return disposeAsset(this.db, companyOf(req), actor(req), code, b); }
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
