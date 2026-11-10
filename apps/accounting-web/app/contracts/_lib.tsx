// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// ส่วนที่หน้าสัญญา (/contracts*) และภาษีจ่ายต่างประเทศ (/tax/foreign) ใช้ร่วม — ป้ายหน้าชั่วคราว · โมดูลปิด · ชื่อประเภท/สถานะ · รูปข้อมูลจาก API (packages/db/src/contract.ts)
import { ButtonLink, css, href, Tag, type TagKind } from '@innovera/ui';
import type { ReactNode } from 'react';

export const TEMP_TEXT = 'หน้าชั่วคราว — ยังไม่มีแบบร่าง (Phase 2A)';
/** ข้อความ 422 จาก requireModuleTx (packages/db/src/swt-hooks.ts) */
export const MODULE_OFF_RE = /ยังไม่ได้เปิดโมดูลสัญญา/u;

export function TempBanner() {
  return <div role="note" style={css('padding: 8px 16px; background: #fcf4d6; border-left: 3px solid #f1c21b; font-size: 13px; color: #161616')}>{TEMP_TEXT}</div>;
}

export function ModuleOff() {
  return (
    <section style={css('border: 1px solid #e0e0e0; padding: 24px; display: flex; flex-direction: column; gap: 12px; max-width: 640px')}>
      <strong style={css('font-size: 16px')}>ยังไม่ได้เปิดโมดูลสัญญา/ซอฟต์แวร์</strong>
      <span style={css('font-size: 14px; color: #525252')}>เปิดโมดูลในหน้าตั้งค่าโมดูลก่อน แล้วจึงสร้างสัญญา รอบบิล และรับรู้รายได้รับล่วงหน้าได้ (ข้อมูลเดิมยังอยู่เมื่อปิดโมดูล)</span>
      <div><ButtonLink href={href('modules')} kind="primary" size={36}>ไปหน้าตั้งค่าโมดูล</ButtonLink></div>
    </section>
  );
}

export function PageHead({ crumb, title, sub, right }: { crumb: string; title: string; sub?: string; right?: ReactNode }) {
  return (
    <>
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>{crumb}</span>
      </header>
      <div style={css('padding: 24px 32px 0; display: flex; flex-direction: column; gap: 16px')}>
        <TempBanner />
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap')}>
          <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>{title}</h1>{sub && <span style={css('font-size: 13px; color: #525252')}>{sub}</span>}</div>
          {right}
        </div>
      </div>
    </>
  );
}

export type Kind = 'license' | 'subscription' | 'support' | 'implementation' | 'usage';
export type Recognition = 'point_in_time' | 'ratably' | 'milestone';
export type Cycle = 'monthly' | 'quarterly' | 'annual';
export const KIND_LABEL: Record<Kind, string> = { license: 'License (ครั้งเดียว)', subscription: 'Subscription (รายรอบ)', support: 'Support / MA (รายรอบ)', implementation: 'Implementation (งานติดตั้ง)', usage: 'ตามการใช้งาน (usage)' };
export const RECOG_LABEL: Record<Recognition, string> = { point_in_time: 'ณ วันที่ออกใบแจ้งหนี้', ratably: 'ตามช่วงเวลา (รายเดือน)', milestone: 'ตามความสำเร็จของงาน' };
/** ค่าตั้งต้นตาม DEFAULT_RECOGNITION ใน packages/db/src/contract.ts */
export const DEFAULT_RECOG: Record<Kind, Recognition> = { license: 'point_in_time', subscription: 'ratably', support: 'ratably', implementation: 'milestone', usage: 'point_in_time' };
/** วิธีรับรู้ที่ backend ยอมรับต่อประเภท (validateContract) */
export const RECOG_OPTIONS: Record<Kind, Recognition[]> = {
  license: ['point_in_time', 'ratably'], subscription: ['ratably', 'point_in_time'], support: ['ratably', 'point_in_time'], implementation: ['milestone', 'point_in_time', 'ratably'], usage: ['point_in_time'],
};
export const CYCLE_LABEL: Record<Cycle, string> = { monthly: 'รายเดือน', quarterly: 'รายไตรมาส', annual: 'รายปี' };
const STATUS: Record<string, [TagKind, string]> = { active: ['success', 'ใช้งาน'], draft: ['neutral', 'ร่าง'], cancelled: ['error', 'ยกเลิก'] };
export function ContractStatus({ status }: { status: string }) {
  const [k, t] = STATUS[status] ?? ['neutral', status];
  return <Tag kind={k}>{t}</Tag>;
}
const DOC_STATUS: Record<string, [TagKind, string]> = { draft: ['warning', 'ร่าง — รออนุมัติ'], posted: ['success', 'อนุมัติแล้ว'], voided: ['error', 'ยกเลิก'] };
export function DocStatus({ status }: { status: string }) {
  const [k, t] = DOC_STATUS[status] ?? ['neutral', status];
  return <Tag kind={k}>{t}</Tag>;
}

export interface ContractRow {
  id: string; code: string; start_date: string; end_date: string; billing_cycle: Cycle; auto_renew: boolean; status: string; cancelled_on: string | null;
  contact_code: string; contact_name: string; recurring_amount?: string; one_time_amount?: string; billed_total?: string;
}
export interface ContractLine {
  id: string; line_no: number; kind: Kind; recognition: Recognition; description: string; product_code: string | null; amount: string; unit_price: string | null; usage_unit: string | null;
  vat: boolean; revenue_account: string | null; start_date: string | null; end_date: string | null; milestone_done_on: string | null;
}
export interface ContractDetail {
  contract: { id: string; code: string; contact_id: string; start_date: string; end_date: string; billing_cycle: Cycle; auto_renew: boolean; status: string; cancelled_on: string | null; notes: string | null };
  lines: ContractLine[];
  invoices: { id: string; doc_no: string | null; status: string; issue_date: string; contract_period_start: string | null; subtotal: string; vat: string; grand_total: string }[];
  schedule: { period: string; amount: string; recognized: string }[];
  scheduleLines?: { contract_line_id: string; period: string; amount: string; recognized: string }[];
  usage: { id: string; contract_line_id: string; usage_date: string; qty: string; external_source: string | null; external_ref: string | null; document_id: string | null }[];
}
export interface Metrics {
  asOf: string; standard: string; mrr: string; arr: string; deferredRevenue: string; unbilled: string; backlog: string; activeContracts: number;
  churn: { month: string; customersStart: number; churnedCustomers: number; customerChurnRate: string; mrrStart: string; churnedMrr: string; mrrChurnRate: string } | null;
}
export interface RecognitionRun { period_no: number; total: string; voided_at: string | null; journal_no: string; journal_date: string }

/** '0.0333' → '3.33%' (อัตราเป็นทศนิยม 4 ตำแหน่ง · ไม่ใช้ float) */
export function pct(rate: string): string {
  const [i = '0', f = ''] = rate.split('.');
  const bp = BigInt(i || '0') * 10000n + BigInt((f + '0000').slice(0, 4));
  return `${bp / 100n}.${String(bp % 100n).padStart(2, '0')}%`;
}
/** 'YYYY-MM' → 'พ.ย. 2569' */
export function thaiYm(ym: string): string {
  const M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${M[Number(ym.slice(5, 7)) - 1] ?? ''} ${Number(ym.slice(0, 4)) + 543}`;
}

export const ST = {
  label: 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252',
  input: 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616',
  cell: 'height: 32px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px; padding: 0 8px; width: 100%; box-sizing: border-box',
  cellNum: 'height: 32px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px; padding: 0 8px; width: 100%; box-sizing: border-box; text-align: right; font-variant-numeric: tabular-nums',
  box: 'border: 1px solid #e0e0e0; padding: 16px; display: flex; flex-direction: column; gap: 12px',
  h2: 'margin: 0; font-size: 16px; font-weight: 600',
  card: 'flex: 1 1 180px; border: 1px solid #e0e0e0; padding: 12px 16px; display: flex; flex-direction: column; gap: 4px',
  cardLabel: 'font-size: 13px; color: #525252',
  cardNum: 'font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums',
  page: 'padding: 16px 32px 96px; display: flex; flex-direction: column; gap: 24px',
} as const;
