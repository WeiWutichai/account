// API ข้อมูลหลัก + ทะเบียนเช็ค + ตั้งค่าบริษัท — logic อยู่ใน @innovera/db/master
// ScreenContacts / ScreenProducts / ScreenCheque / ScreenSettings .dc.html
import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Put, Query, Req, Res, UnprocessableEntityException } from '@nestjs/common';
import type { Db } from '@innovera/db';
import {
  bounceCheque, chequeRegister, clearCheque, companySettings, contactDetail, contactsOverview, CONTACT_ROLES, depositCheques, listBankAccounts, productDetail, productsOverview,
  saveBankAccount, saveCompanySettings, saveContact, saveProduct, sidebarBadges, sidebarUser, type BankAccountInput, type CompanySettingsInput, type ContactInput, type ContactRole, type ProductInput,
} from '@innovera/db/master';
import { importMaster, masterTemplate, type MasterKind } from '@innovera/db/master-import';
import type { Request, Response } from 'express';
import { companyOf, Need, roleOf, userOf } from './context.js';
import { DB } from './db.js';

const actor = (req: Request) => ({ userId: userOf(req).userId === 'dev' ? null : userOf(req).userId, role: roleOf(req) });
const today = (): string => process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10);
const date = (s?: string) => { if (s && !/^\d{4}-\d{2}-\d{2}$/u.test(s)) throw new UnprocessableEntityException('วันที่ต้องเป็น YYYY-MM-DD'); return s ?? today(); };
const KINDS = ['service', 'goods', 'expense', 'kit'] as const;
const masterKind = (k: string): MasterKind => { if (k !== 'contacts' && k !== 'products') throw new NotFoundException('ไม่พบข้อมูลหลักนี้'); return k; };

@Controller('v1')
export class MasterController {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ---------- นำเข้า Excel (ScreenContacts / ScreenProducts "นำเข้า Excel") ----------
  @Need('journal', 'read') @Get('master/:kind/import/template')
  async importTemplate(@Res() res: Response, @Param('kind') kind: string) {
    const k = masterKind(kind);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${k}-template.xlsx"`);
    res.end(await masterTemplate(k));
  }
  /** แนบไฟล์ .xlsx เป็น body · commit=1 บันทึก (ไม่ส่ง = ตรวจอย่างเดียว คืนรายการแถว + ข้อผิดพลาด) */
  @Need('journal', 'write') @Post('master/:kind/import')
  importFile(@Req() req: Request, @Param('kind') kind: string, @Query('commit') commit?: string) {
    const k = masterKind(kind);
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new UnprocessableEntityException('ต้องแนบไฟล์ Excel (.xlsx)');
    return importMaster(this.db, companyOf(req), actor(req).userId, k, body, { commit: commit === '1' || commit === 'true' });
  }

  // ---------- คู่ค้า ----------
  @Need('journal', 'read') @Get('master/contacts')
  contacts(@Req() req: Request, @Query('q') q?: string, @Query('role') role?: string) {
    const r = CONTACT_ROLES.find((x) => x === role);
    return contactsOverview(this.db, companyOf(req), { ...(q ? { q } : {}), ...(r ? { role: r as ContactRole } : {}) });
  }
  @Need('journal', 'read') @Get('master/contacts/:id')
  async contact(@Req() req: Request, @Param('id') id: string) {
    const c = await contactDetail(this.db, companyOf(req), id, today());
    if (!c) throw new NotFoundException('ไม่พบคู่ค้า');
    return c;
  }
  @Need('journal', 'write') @Post('master/contacts')
  createContact(@Req() req: Request, @Body() b: ContactInput) { return saveContact(this.db, companyOf(req), actor(req).userId, b); }
  @Need('journal', 'write') @Put('master/contacts/:id')
  updateContact(@Req() req: Request, @Param('id') id: string, @Body() b: ContactInput) { return saveContact(this.db, companyOf(req), actor(req).userId, b, id); }

  // ---------- สินค้าและบริการ ----------
  @Need('journal', 'read') @Get('master/products')
  products(@Req() req: Request, @Query('kind') kind?: string) {
    const k = KINDS.find((x) => x === kind);
    return productsOverview(this.db, companyOf(req), k ? { kind: k } : {});
  }
  @Need('journal', 'read') @Get('master/products/:code')
  async product(@Req() req: Request, @Param('code') code: string) {
    const p = await productDetail(this.db, companyOf(req), code);
    if (!p) throw new NotFoundException('ไม่พบรายการ');
    return p;
  }
  @Need('journal', 'write') @Post('master/products')
  createProduct(@Req() req: Request, @Body() b: ProductInput) { return saveProduct(this.db, companyOf(req), actor(req).userId, b); }
  @Need('journal', 'write') @Put('master/products/:code')
  updateProduct(@Req() req: Request, @Param('code') code: string, @Body() b: ProductInput) { return saveProduct(this.db, companyOf(req), actor(req).userId, b, code); }

  // ---------- ทะเบียนบัญชีธนาคารของบริษัท (แบบพิมพ์ "โอนเข้าบัญชี …") ----------
  // TODO(Wei): ไม่มีแบบร่างหน้าแก้ทะเบียนบัญชีธนาคาร → ใช้ผ่าน API เท่านั้น
  @Need('finance', 'read') @Get('bank-accounts')
  bankAccounts(@Req() req: Request) { return listBankAccounts(this.db, companyOf(req)); }
  @Need('settings', 'write') @Put('bank-accounts/:gl')
  saveBank(@Req() req: Request, @Param('gl') gl: string, @Body() b: Omit<BankAccountInput, 'glAccount'>) { return saveBankAccount(this.db, companyOf(req), actor(req).userId, { ...b, glAccount: gl }); }

  // ---------- ทะเบียนเช็ค ----------
  @Need('finance', 'read') @Get('cheques')
  cheques(@Req() req: Request, @Query('direction') d?: string) { return chequeRegister(this.db, companyOf(req), d === 'issued' ? 'issued' : 'received', today()); }
  @Need('finance', 'post') @Post('cheques/deposit')
  deposit(@Req() req: Request, @Body() b: { ids: string[]; date?: string }) { return depositCheques(this.db, companyOf(req), actor(req), b.ids ?? [], date(b.date)); }
  @Need('finance', 'post') @Post('cheques/:id/clear')
  clear(@Req() req: Request, @Param('id') id: string, @Body() b: { date?: string; bankAccount?: string }) {
    return clearCheque(this.db, companyOf(req), actor(req), id, { date: date(b.date), bankAccount: b.bankAccount ?? '1100100' });
  }
  @Need('finance', 'void') @Post('cheques/:id/bounce')
  bounce(@Req() req: Request, @Param('id') id: string, @Body() b: { date?: string; reason: string }) {
    return bounceCheque(this.db, companyOf(req), actor(req), id, { date: date(b.date), reason: b.reason ?? '' });
  }

  // ---------- Sidebar (ทุกหน้า) ----------
  @Get('sidebar')
  async sidebar(@Req() req: Request) {
    const [badges, user] = await Promise.all([sidebarBadges(this.db, companyOf(req), today()), sidebarUser(this.db, companyOf(req), actor(req).userId)]);
    return { badges, user };
  }

  // ---------- ตั้งค่าบริษัท ----------
  @Need('settings', 'read') @Get('company-settings')
  settings(@Req() req: Request) { return companySettings(this.db, companyOf(req)); }
  @Need('settings', 'write') @Put('company-settings')
  saveSettings(@Req() req: Request, @Body() b: CompanySettingsInput) { return saveCompanySettings(this.db, companyOf(req), actor(req).userId, b); }
}
