// ชุดเลขที่เอกสาร (ScreenDocSettings / ScreenDocSeriesEdit) — แถวตามแบบร่าง · ค่าจริงจาก GET doc-settings (+ ค่าตั้งต้นของตัวสร้างเลขที่ใน packages/db)
export interface DocSetting { doc_type: string; prefix: string; pattern: string; reset: 'monthly' | 'yearly' | 'never'; settings: Record<string, unknown>; updated_at?: string }

export interface SeriesDef {
  key: string;            // doc_type ที่บันทึก (PUT doc-settings/:key)
  label: string;          // ชื่อในตาราง ScreenDocSettings
  title: string;          // ชื่อในหัว ScreenDocSeriesEdit
  branch: string;         // คอลัมน์สาขา
  branchOpt: 'HQ' | '00001' | 'ALL';
  types: string[];        // ประเภทที่แสดงรูปแบบ
  seqTypes: string[];     // ประเภทที่แสดงตัวอย่างถัดไป/ลำดับปัจจุบัน
  rawPattern?: boolean;   // แสดง {PREFIX} ตามตัว (ชุดที่ใช้ร่วมหลายประเภท)
  extra?: string;         // ต่อท้ายรูปแบบ
  noData?: boolean;       // ชุดที่ตัวสร้างเลขที่ยังไม่รองรับ (แยกสาขา)
}

// แถวและข้อความตามแบบร่าง ScreenDocSettings.dc.html (ลำดับเดียวกัน)
export const SERIES: SeriesDef[] = [
  { key: 'IV', label: 'ใบกำกับภาษี / ใบแจ้งหนี้ (IV)', title: 'ใบแจ้งหนี้ / ใบกำกับภาษี (IV)', branch: 'สำนักงานใหญ่', branchOpt: 'HQ', types: ['IV'], seqTypes: ['IV'] },
  // TODO(Wei/API): ชุดเลขที่แยกสาขา — ตัวสร้างเลขที่ (nextNumber) ยังไม่รองรับ {BR}/แยกสาขา · แสดงค่าเมื่อมีการตั้งค่า IV-00001 เท่านั้น
  { key: 'IV-00001', label: 'ใบกำกับภาษี / ใบแจ้งหนี้ (IV)', title: 'ใบแจ้งหนี้ / ใบกำกับภาษี (IV)', branch: 'สาขา 00001', branchOpt: '00001', types: ['IV-00001'], seqTypes: [], noData: true },
  { key: 'RV', label: 'ใบเสร็จรับเงิน / ใบกำกับภาษี (RV) — ใช้ร่วมกันทุกสาขา', title: 'ใบเสร็จรับเงิน / ใบกำกับภาษี (RV)', branch: 'ทุกสาขา', branchOpt: 'ALL', types: ['RV'], seqTypes: ['RV'] },
  { key: 'QO', label: 'ใบเสนอราคา (QO) / ใบสั่งขาย (SO)', title: 'ใบเสนอราคา (QO)', branch: 'ทุกสาขา', branchOpt: 'ALL', types: ['QO', 'SO'], seqTypes: ['QO'] },
  { key: 'CN', label: 'ใบลดหนี้ (CN) / ใบเพิ่มหนี้ (DN)', title: 'ใบลดหนี้ (CN)', branch: 'ทุกสาขา', branchOpt: 'ALL', types: ['CN'], seqTypes: ['CN'] },
  { key: 'AP', label: 'บิลซื้อ (AP) · ค่าใช้จ่าย (EXP) · ใบสั่งซื้อ (PO) · ใบขอซื้อ (PR)', title: 'บิลซื้อ (AP)', branch: 'ทุกสาขา', branchOpt: 'ALL', types: ['AP'], seqTypes: ['AP', 'PO'], rawPattern: true },
  { key: 'WHT', label: 'หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)', title: 'หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)', branch: 'ทุกสาขา', branchOpt: 'ALL', types: ['WHT'], seqTypes: ['WHT'] },
  { key: 'JV', label: 'บันทึกรายวัน (JV) · ค่าเสื่อม · ปิดปี', title: 'บันทึกรายวัน (JV)', branch: 'ทุกสาขา', branchOpt: 'ALL', types: ['JV'], seqTypes: ['JV'], extra: ' · งวด 13: JV{YY}13-{SEQ:4}' },
];
export const seriesDef = (key: string): SeriesDef | undefined => SERIES.find((s) => s.key === key);

export const DEFAULT_PATTERN = '{PREFIX}{YY}{MM}-{SEQ:4}';
export const RESET_LABEL: Record<DocSetting['reset'], string> = { monthly: 'รายเดือน', yearly: 'รายปี', never: 'ไม่รีเซ็ต' };
/** ค่าตั้งต้นเมื่อยังไม่มีแถวใน acct.doc_setting (ตรงกับ prefixOf/nextNumber ใน packages/db) */
export function settingOf(all: DocSetting[], type: string): DocSetting {
  return all.find((s) => s.doc_type === type) ?? { doc_type: type, prefix: type.replace(/[^A-Z]/gu, '') || type, pattern: DEFAULT_PATTERN, reset: 'monthly', settings: {} };
}
export const shownPattern = (s: DocSetting, raw = false): string => (raw ? s.pattern : s.pattern.replace(/\{PREFIX\}/gu, s.prefix));

/**
 * เลขที่ตามรูปแบบ · iso = วันที่เอกสาร (ค.ศ.)
 * TODO(Wei): แบบร่างบอกว่า {YY}/{YYYY} เป็นปี พ.ศ. แต่ตัวอย่างในแบบร่างเอง (IV2611-0063 = พ.ย. 2569) และตัวสร้างเลขที่ใน packages/db (nextNumber)
 *   ใช้ 2 หลักท้ายของ ค.ศ. → {YY} = ค.ศ. 2 หลัก (ตรงกับเลขที่จริง) · {YYYY} = พ.ศ. 4 หลัก (ตามตัวอย่าง CN2569-00012) · รอ Wei ยืนยัน
 */
export function formatNo(pattern: string, prefix: string, iso: string, seq: number, branch = '00000'): string {
  const [y = '2026', m = '01'] = iso.split('-');
  const be = String(Number(y) + 543);
  return pattern.replace(/\{PREFIX\}/gu, prefix).replace(/\{YYYY\}/gu, be).replace(/\{YY\}/gu, y.slice(2)).replace(/\{CY\}/gu, y).replace(/\{MM\}/gu, m)
    .replace(/\{BR\}/gu, branch.slice(-2)).replace(/\{SEQ:(\d+)\}/gu, (_, n: string) => String(seq).padStart(Number(n), '0'));
}
export interface Counter { doc_type: string; period_key: string; next_no: number }
/** ลำดับล่าสุดที่ออกแล้วในเดือนนี้ = next_no − 1 จาก acct.number_series (GET doc-settings/counters · counter ผูกกับ prefix) */
export function currentSeq(s: DocSetting, counters: readonly Counter[]): number {
  const c = counters.find((x) => x.doc_type === s.prefix);
  return c ? Math.max(0, c.next_no - 1) : 0;
}
export const seqDigits = (pattern: string): number => Number(/\{SEQ:(\d+)\}/u.exec(pattern)?.[1] ?? '4');
