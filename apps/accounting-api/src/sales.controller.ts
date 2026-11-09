// API ของงานขาย + รับเงิน (M4 · docs/technical-plan-M4.md) — logic อยู่ใน @innovera/db/sales
import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Db } from '@innovera/db';
import {
  approveDocument, convertDocument, createBilling, docSettings, editReference, getDocument, listDocuments, openItems, receivePayment, rejectDocument, saveDocSetting,
  saveSalesDraft, shareDocument, sharedDocument, submitDocument, voidDocument, type ReceiptInput, type SalesDraftInput,
} from '@innovera/db/sales';
import { docTotals, receiptTotals } from '@innovera/ledger';
import { bahtText } from '@innovera/tax-th';
import type { Request } from 'express';
import { companyOf, Need, Public, roleOf, userOf } from './context.js';
import { DB } from './db.js';

const actor = (req: Request) => ({ userId: userOf(req).userId === 'dev' ? null : userOf(req).userId, role: roleOf(req) });
const today = (): string => process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10);

@Controller('v1')
export class SalesController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Need('sales', 'read') @Get('documents')
  list(@Req() req: Request, @Query() q: { type?: string; status?: string; from?: string; to?: string; contact?: string; q?: string }) {
    return listDocuments(this.db, companyOf(req), { ...(q.type ? { docType: q.type.split(',') } : {}), ...(q.status ? { status: q.status } : {}), ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}), ...(q.contact ? { contactId: q.contact } : {}), ...(q.q ? { q: q.q } : {}) });
  }
  @Need('sales', 'read') @Get('documents/:id')
  async get(@Req() req: Request, @Param('id') id: string) {
    const d = await getDocument(this.db, companyOf(req), id);
    if (!d) throw new NotFoundException('ไม่พบเอกสาร');
    return d;
  }
  /** คำนวณยอดระหว่างกรอก (ไม่บันทึก) — ตัวเลขบนฟอร์มมาจาก engine เดียวกับตอนบันทึก */
  @Need('sales', 'read') @Post('documents/preview')
  preview(@Body() b: { lines: { qty: string; unitPrice: string; discount?: string; vat?: boolean }[]; priceInclVat?: boolean; billDiscount?: string }) {
    const t = docTotals(b.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, discount: (l.discount ?? '0.00') as never, vat: l.vat ?? true })), { priceInclVat: b.priceInclVat ?? false, billDiscount: (b.billDiscount ?? '0.00') as never });
    return { ...t, amountText: bahtText(t.grandTotal) };
  }
  @Need('sales', 'write') @Post('documents')
  async create(@Req() req: Request, @Body() b: SalesDraftInput) { return { id: await saveSalesDraft(this.db, companyOf(req), actor(req), b) }; }
  @Need('sales', 'write') @Put('documents/:id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() b: SalesDraftInput) { return { id: await saveSalesDraft(this.db, companyOf(req), actor(req), b, id) }; }
  @Need('sales', 'write') @Post('documents/:id/submit')
  async submit(@Req() req: Request, @Param('id') id: string) { await submitDocument(this.db, companyOf(req), actor(req), id); return { ok: true }; }
  @Need('sales', 'post') @Post('documents/:id/reject')
  async reject(@Req() req: Request, @Param('id') id: string, @Body() b: { reason: string }) { await rejectDocument(this.db, companyOf(req), actor(req), id, b.reason); return { ok: true }; }
  @Need('sales', 'post') @Post('documents/:id/approve')
  approve(@Req() req: Request, @Param('id') id: string) { return approveDocument(this.db, companyOf(req), actor(req), id); }
  @Need('void', 'post') @Post('documents/:id/void')
  voidDoc(@Req() req: Request, @Param('id') id: string, @Body() b: { reason: string; date?: string }) { return voidDocument(this.db, companyOf(req), actor(req), id, { reason: b.reason, date: b.date ?? today() }); }
  @Need('sales', 'write') @Put('documents/:id/reference')
  async reference(@Req() req: Request, @Param('id') id: string, @Body() b: Record<string, string | null>) { await editReference(this.db, companyOf(req), actor(req), id, b); return { ok: true }; }
  @Need('sales', 'write') @Post('documents/:id/convert')
  async convert(@Req() req: Request, @Param('id') id: string, @Body() b: { to: 'SO' | 'IV' | 'DP'; issueDate?: string }) {
    return { id: await convertDocument(this.db, companyOf(req), actor(req), id, b.to, { issueDate: b.issueDate ?? today() }) };
  }
  @Need('sales', 'write') @Post('documents/:id/share')
  async share(@Req() req: Request, @Param('id') id: string) { return { token: await shareDocument(this.db, companyOf(req), actor(req), id) }; }

  /** S6 หน้าเอกสารสำหรับลูกค้า (ScreenSendDoc) — ไม่ต้องเข้าสู่ระบบ · token สุ่ม หมดอายุได้ · อ่านอย่างเดียว */
  @Public() @Get('shared/:token')
  async shared(@Param('token') token: string) {
    const d = await sharedDocument(this.db, token);
    if (!d) throw new NotFoundException('ลิงก์หมดอายุหรือไม่ถูกต้อง');
    return d;
  }

  // ---------- รับชำระ / วางบิล ----------
  @Need('finance', 'read') @Get('contacts/:id/open-items')
  open(@Req() req: Request, @Param('id') id: string) { return openItems(this.db, companyOf(req), id); }
  @Need('finance', 'read') @Post('receipts/preview')
  receiptPreview(@Body() b: { applications: Parameters<typeof receiptTotals>[0]; fee?: string }) {
    const t = receiptTotals(b.applications, (b.fee ?? '0.00') as never);
    return { ...t, amountText: bahtText(t.settled as never) };
  }
  @Need('finance', 'post') @Post('receipts')
  receive(@Req() req: Request, @Body() b: ReceiptInput) { return receivePayment(this.db, companyOf(req), actor(req), b); }
  @Need('sales', 'write') @Post('billings')
  billing(@Req() req: Request, @Body() b: { contactId: string; date: string; dueDate?: string; documentIds: string[]; notes?: string }) { return createBilling(this.db, companyOf(req), actor(req), b); }

  // ---------- ตั้งค่าเอกสาร ----------
  @Need('sales', 'read') @Get('doc-settings')
  async settings(@Req() req: Request) { return (await docSettings(this.db, companyOf(req), today())).settings; }
  /** ลำดับถัดไปของเดือนนี้ต่อคำนำหน้า (acct.number_series) — ScreenDocSettings "ลำดับปัจจุบัน" */
  @Need('sales', 'read') @Get('doc-settings/counters')
  async counters(@Req() req: Request) { return (await docSettings(this.db, companyOf(req), today())).counters; }
  @Need('settings', 'write') @Put('doc-settings/:type')
  async saveSetting(@Req() req: Request, @Param('type') type: string, @Body() b: { prefix: string; pattern?: string; reset?: 'monthly' | 'yearly' | 'never'; settings?: Record<string, unknown> }) {
    await saveDocSetting(this.db, companyOf(req), { docType: type, ...b });
    return { ok: true };
  }
}
