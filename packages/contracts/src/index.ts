// @innovera/contracts — schema กลางที่ API, MCP, TMS ใช้ร่วมกัน (zod 4) · เงินเป็น string เสมอ
import { z } from 'zod';

export const Money = z.string().regex(/^-?\d{1,16}\.\d{2}$/u, 'ยอดเงินต้องเป็น string ทศนิยม 2 ตำแหน่ง').describe('Money (THB) เช่น "1070.00"');
export const Qty = z.string().regex(/^-?\d{1,14}(\.\d{1,4})?$/u).describe('จำนวน/ราคาต่อหน่วย สูงสุด 4 ตำแหน่ง');
export const Rate = z.string().regex(/^\d{1,3}(\.\d{1,4})?$/u).describe('อัตรา % สูงสุด 4 ตำแหน่ง เช่น "7" "3.0000"');
export const AccountCode = z.string().regex(/^\d{7}$/u).describe('รหัสบัญชี 7 หลัก');
export const IsoDate = z.iso.date();
export const Uuid = z.uuid();
export const TaxId = z.string().regex(/^\d{13}$/u);
export const BranchCode = z.string().regex(/^\d{5}$/u);

export const DocType = z.enum(['QO', 'SO', 'BL', 'IV', 'CN', 'DN', 'DP', 'RV', 'PR', 'PO', 'AP', 'EXP', 'CNR', 'DNR', 'PV', 'JV']);
export const DocStatus = z.enum(['draft', 'pending_approval', 'approved', 'posted', 'voided']);

export const DocumentLineInput = z.object({
  line_type: z.enum(['item', 'heading', 'note']).default('item'),
  product_code: z.string().optional(),
  description: z.string().min(1),
  qty: Qty.optional(),
  unit_price: Qty.optional(),
  discount: Money.optional(),
  amount: Money.optional(),
  vat_rate: Rate.optional(),
  account_code: AccountCode.optional(),
});

/** API/MCP ภายนอกสร้างได้แค่ร่าง (CLAUDE.md) · external_source + external_ref ห้ามซ้ำต่อบริษัท (idempotent) */
export const DocumentDraftCreate = z.object({
  doc_type: DocType,
  issue_date: IsoDate,
  due_date: IsoDate.optional(),
  contact_code: z.string().min(1),
  price_incl_vat: z.boolean().default(false),
  branch_code: BranchCode.default('00000'),
  lines: z.array(DocumentLineInput).min(1),
  external_source: z.string().min(1).optional(),
  external_ref: z.string().min(1).optional(),
}).strict().refine((d) => (d.external_source === undefined) === (d.external_ref === undefined), {
  message: 'external_source และ external_ref ต้องมาคู่กัน',
});

export const JournalLineOut = z.object({
  side: z.enum(['Dr', 'Cr']),
  account_code: AccountCode,
  amount: Money,
  contact_id: Uuid.nullable().optional(),
});

export const WebhookEventType = z.enum(['document.posted', 'document.voided', 'payment.received', 'payment.paid', 'period.closed']);
export const WebhookEvent = z.object({
  id: Uuid,
  type: WebhookEventType,
  company_id: Uuid,
  occurred_at: z.iso.datetime(),
  data: z.object({ document_id: Uuid.optional(), doc_no: z.string().optional(), amount: Money.optional(), external_ref: z.string().optional() }),
});

export type DocumentDraftCreate = z.infer<typeof DocumentDraftCreate>;
export type WebhookEvent = z.infer<typeof WebhookEvent>;

export const schemas = { Money, Qty, Rate, AccountCode, DocType, DocStatus, DocumentLineInput, DocumentDraftCreate, JournalLineOut, WebhookEventType, WebhookEvent } as const;
