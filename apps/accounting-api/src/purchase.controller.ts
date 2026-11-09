// API ฝั่งซื้อ + จ่ายเงิน (M5 · docs/technical-plan-M5.md) — logic อยู่ใน @innovera/db/purchase
import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Db } from '@innovera/db';
import { approvePayment, approvePurchase, createPayment, createPaymentRun, payables, pettyCashSummary, reimbursePettyCash, savePettyCash, savePurchaseDraft, setCompanySetting, whtCertificates, type PaymentInput, type PettyCashInput, type PurchaseDraftInput } from '@innovera/db/purchase';
import { editPurchaseDoc, type PurchaseEditInput } from '@innovera/db/sales';
import { WHT_TYPES } from '@innovera/tax-th';
import type { Request } from 'express';
import { companyOf, Need, roleOf, userOf } from './context.js';
import { DB } from './db.js';

const actor = (req: Request) => ({ userId: userOf(req).userId === 'dev' ? null : userOf(req).userId, role: roleOf(req) });

@Controller('v1')
export class PurchaseController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** ScreenDocEdit: แก้บิลซื้อ/ค่าใช้จ่ายที่ผ่านรายการแล้ว (ข้อมูลอ้างอิง + ย้ายบัญชีค่าใช้จ่ายด้วย JV) · สิทธิ์ผู้จัดการบัญชี (ผ่านรายการซื้อ) */
  @Need('purchase', 'post') @Put('documents/:id/purchase-edit')
  purchaseEdit(@Req() req: Request, @Param('id') id: string, @Body() b: PurchaseEditInput) {
    return editPurchaseDoc(this.db, companyOf(req), actor(req), id, { ...b, date: b.date ?? (process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10)) });
  }

  @Need('purchase', 'write') @Post('purchases')
  async create(@Req() req: Request, @Body() b: PurchaseDraftInput) { return { id: await savePurchaseDraft(this.db, companyOf(req), actor(req), b) }; }
  @Need('purchase', 'write') @Put('purchases/:id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() b: PurchaseDraftInput) { return { id: await savePurchaseDraft(this.db, companyOf(req), actor(req), b, id) }; }
  @Need('purchase', 'post') @Post('purchases/:id/approve')
  approve(@Req() req: Request, @Param('id') id: string) { return approvePurchase(this.db, companyOf(req), actor(req), id); }

  @Need('finance', 'read') @Get('payables')
  payables(@Req() req: Request, @Query('contact') contact?: string) { return payables(this.db, companyOf(req), contact); }
  @Need('finance', 'write') @Post('payments')
  pay(@Req() req: Request, @Body() b: PaymentInput) { return createPayment(this.db, companyOf(req), actor(req), b); }
  @Need('finance', 'write') @Post('payment-runs')
  run(@Req() req: Request, @Body() b: { date: string; payFrom: string; billIds: string[]; batchRef: string; method?: PaymentInput['method'] }) { return createPaymentRun(this.db, companyOf(req), actor(req), b); }
  @Need('approve_pay', 'post') @Post('payments/:id/approve')
  approvePay(@Req() req: Request, @Param('id') id: string) { return approvePayment(this.db, companyOf(req), { ...actor(req), approvalLimit: userOf(req).approvalLimit }, id); }

  @Need('finance', 'read') @Get('petty-cash')
  petty(@Req() req: Request) { return pettyCashSummary(this.db, companyOf(req)); }
  @Need('finance', 'write') @Post('petty-cash')
  pettyAdd(@Req() req: Request, @Body() b: PettyCashInput) { return savePettyCash(this.db, companyOf(req), actor(req), b); }
  @Need('approve_pay', 'post') @Post('petty-cash/reimburse')
  reimburse(@Req() req: Request, @Body() b: { date: string; payFrom: string }) { return reimbursePettyCash(this.db, companyOf(req), actor(req), b); }

  @Need('reports', 'read') @Get('wht-certificates')
  certs(@Req() req: Request, @Query() q: { from?: string; to?: string; pnd?: '3' | '53' }) { return whtCertificates(this.db, companyOf(req), q); }
  @Need('purchase', 'read') @Get('wht-types')
  types() { return WHT_TYPES; }
  /** ค่าตั้งที่รอผู้สอบบัญชี (CLAUDE.md) — เปลี่ยนได้เฉพาะผู้มีสิทธิ์ตั้งค่า */
  @Need('settings', 'write') @Put('company-settings/:key')
  async setting(@Req() req: Request, @Param('key') key: string, @Body() b: { value: unknown }) {
    if (!['tax.wht.freelance_software_dev', 'tax.filing.online_extension'].includes(key)) return { ok: false, error: 'ไม่รู้จักค่าตั้งนี้' };
    await setCompanySetting(this.db, companyOf(req), key, b.value);
    return { ok: true };
  }
}
