// API ของหน้า B1–B4 + A4 (ผังบัญชี · บันทึกรายวัน · สูตรลงบัญชี · แยกประเภท · ยอดยกมา)
import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Put, Query, Req, Res, UnprocessableEntityException } from '@nestjs/common';
import type { Db } from '@innovera/db';
import { importWorkbook, saveOpeningBalance, TEMPLATE } from '@innovera/db/import';
import { accountLedger, companyContext, getJournal, listAccounts, listContacts, listRules, listTemplates, openingBalance, saveRule, postJournalDraft, saveJournalDraft, saveTemplate, type JournalDraftInput } from '@innovera/db/queries';
import { post, toTuples, type PostingInput, type RuleDefinition } from '@innovera/ledger';
import { ruleCheck } from './rule-check.js';
import ExcelJS from 'exceljs';
import type { Request, Response } from 'express';
import { companyOf, roleOf } from './context.js';
import { DB } from './db.js';

const today = (): string => process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10);

@Controller('v1')
export class GlController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get('context')
  context(@Req() req: Request) {
    return companyContext(this.db, companyOf(req), today());
  }

  @Get('accounts')
  accounts(@Req() req: Request, @Query('year') year: string, @Query('period') period: string) {
    return listAccounts(this.db, companyOf(req), { fiscalYear: Number(year), upToPeriod: Number(period) });
  }

  @Get('accounts/export')
  async exportAccounts(@Req() req: Request, @Res() res: Response, @Query('year') year: string, @Query('period') period: string) {
    const rows = await listAccounts(this.db, companyOf(req), { fiscalYear: Number(year), upToPeriod: Number(period) });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('ผังบัญชี');
    ws.addRow([...TEMPLATE.ผังบัญชี, 'หมวด', 'ยอดคงเหลือ', 'สถานะ']);
    for (const r of rows) ws.addRow([r.code, r.name, r.type, r.is_control ? 'ใช่' : '', r.category ?? '', r.balance ?? '', r.active ? 'ใช้งาน' : 'ปิดใช้']);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="chart-of-accounts.xlsx"');
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  @Get('import/template')
  async template(@Res() res: Response) {
    const wb = new ExcelJS.Workbook();
    for (const [name, cols] of Object.entries(TEMPLATE)) wb.addWorksheet(name).addRow([...cols]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="opening-balance-template.xlsx"');
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  @Get('opening')
  opening(@Req() req: Request, @Query('year') year: string) {
    return openingBalance(this.db, companyOf(req), Number(year));
  }

  @Post('opening')
  saveOpening(@Req() req: Request, @Query('year') year: string, @Body() b: { rows: { account: string; debit?: string; credit?: string }[] }) {
    const role = roleOf(req);
    if (role !== 'owner' && role !== 'accounting_manager') throw new UnprocessableEntityException('ยืนยันยอดยกมาได้เฉพาะเจ้าของ/ผู้จัดการบัญชี');
    return saveOpeningBalance(this.db, companyOf(req), b.rows, { fiscalYear: Number(year), role });
  }

  @Post('import')
  async import(@Req() req: Request, @Query('year') year: string) {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new UnprocessableEntityException('ต้องแนบไฟล์ Excel (.xlsx)');
    const role = roleOf(req);
    if (role !== 'owner' && role !== 'accounting_manager') throw new UnprocessableEntityException('นำเข้ายอดยกมาได้เฉพาะเจ้าของ/ผู้จัดการบัญชี');
    return importWorkbook(this.db, companyOf(req), body, { fiscalYear: Number(year), role });
  }

  @Get('ledger')
  ledger(@Req() req: Request, @Query('account') account: string, @Query('from') from: string, @Query('to') to: string) {
    return accountLedger(this.db, companyOf(req), { account, from, to });
  }

  @Get('ledger/export')
  async exportLedger(@Req() req: Request, @Res() res: Response, @Query('account') account: string, @Query('from') from: string, @Query('to') to: string) {
    const l = await accountLedger(this.db, companyOf(req), { account, from, to });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`แยกประเภท ${account}`);
    ws.addRow(['วันที่', 'เอกสาร', 'สมุด', 'คำอธิบาย', 'คู่ค้า', 'เดบิต', 'เครดิต', 'คงเหลือ']);
    ws.addRow([from, '', '', 'ยอดยกมา', '', '', '', l.opening]);
    for (const r of l.rows) ws.addRow([r.date, r.journal_no, r.book, r.description ?? '', r.contact ?? '', r.debit, r.credit, r.balance]);
    ws.addRow(['', '', '', 'รวมงวด · ยอดยกไป', '', l.total_debit, l.total_credit, l.closing]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ledger-${account}.xlsx"`);
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  @Get('rules')
  async rules(@Req() req: Request) {
    return (await listRules(this.db, companyOf(req))).map((r) => ({ ...r, check: ruleCheck(r) }));
  }

  @Post('rules')
  saveRule(@Req() req: Request, @Body() def: RuleDefinition) {
    const check = ruleCheck(def);
    if (!check.ok) throw new UnprocessableEntityException(`สูตรไม่ดุล: ${check.message}`);
    return saveRule(this.db, companyOf(req), def);
  }

  /** ทดสอบสูตรกับยอดของเอกสาร (ScreenFormula "ทดสอบสูตรกับเอกสารจริง") */
  @Post('rules/preview')
  async preview(@Req() req: Request, @Body() b: { code: string; input?: PostingInput; docNo?: string }) {
    const rule = (await listRules(this.db, companyOf(req))).find((r) => r.code === b.code);
    if (!rule) throw new NotFoundException(`ไม่พบสูตร ${b.code}`);
    if (b.input) return { lines: toTuples(post(rule, b.input)) };
    // TODO(M4): ดึงยอดจากเอกสารจริงตามเลขที่ (ต้องมีเอกสารขาย/ซื้อที่ผ่านสูตรก่อน)
    throw new UnprocessableEntityException(`ยังไม่มีเอกสาร ${b.docNo ?? ''} ในระบบ — ทดสอบกับเอกสารจริงได้เมื่อเปิดใช้เอกสารขาย/ซื้อ (M4)`);
  }

  @Get('journals/templates')
  templates(@Req() req: Request) {
    return listTemplates(this.db, companyOf(req));
  }

  @Post('journals/templates')
  saveTemplate(@Req() req: Request, @Body() b: { name: string; book: string; description: string; lines: unknown }) {
    return saveTemplate(this.db, companyOf(req), b);
  }

  @Get('contacts')
  contacts(@Req() req: Request) {
    return listContacts(this.db, companyOf(req));
  }

  @Get('journals/by-no/:no')
  async journalByNo(@Req() req: Request, @Param('no') no: string) {
    const j = await getJournal(this.db, companyOf(req), { no });
    if (!j) throw new NotFoundException(`ไม่พบ ${no}`);
    return j;
  }

  @Get('journals/:id')
  async journal(@Req() req: Request, @Param('id') id: string) {
    const j = await getJournal(this.db, companyOf(req), { id });
    if (!j) throw new NotFoundException('ไม่พบรายการ');
    return j;
  }

  @Post('journals')
  async createDraft(@Req() req: Request, @Body() b: JournalDraftInput) {
    return { id: await saveJournalDraft(this.db, companyOf(req), b) };
  }

  @Put('journals/:id')
  async updateDraft(@Req() req: Request, @Param('id') id: string, @Body() b: JournalDraftInput) {
    return { id: await saveJournalDraft(this.db, companyOf(req), b, id) };
  }

  @Post('journals/:id/post')
  postDraft(@Req() req: Request, @Param('id') id: string) {
    return postJournalDraft(this.db, companyOf(req), id, roleOf(req));
  }
}
