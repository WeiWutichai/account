// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// ชนิดข้อมูลของโมดูล Phase 2A (หลายสกุลเงิน · สาขา · สต็อก · ซอฟต์แวร์) ที่ฟอร์มเดิมใช้ — ช่องของโมดูลแสดงเฉพาะเมื่อเปิดโมดูล
// (ปิดทุกโมดูล = หน้าจอ Phase 1 ตามแบบร่างเดิมทุกพิกเซล)

/** GET /v1/modules */
export interface CompanyModules { inventory: boolean; multi_currency: boolean; branches: boolean; software: boolean }
export const MODULES_OFF: CompanyModules = { inventory: false, multi_currency: false, branches: false, software: false };

export interface Currency { code: string; name: string; decimals: number; active: boolean }
export interface Branch { code: string; name: string; address: string | null; tax_id: string | null; files_separately: boolean; active: boolean }
export interface Warehouse { id: string; code: string; name: string; branch_code?: string; is_default?: boolean; active?: boolean }

/** ข้อมูลโมดูลที่ฟอร์มเอกสารใช้ (โหลดฝั่ง server เฉพาะโมดูลที่เปิด) */
export interface P2A { modules: CompanyModules; currencies: Currency[]; branches: Branch[]; warehouses: Warehouse[] }
export const P2A_OFF: P2A = { modules: MODULES_OFF, currencies: [], branches: [], warehouses: [] };

/** ฟิลด์ P2A บนเอกสาร (GET /v1/documents/:id doc.*) */
export interface DocFxFields { currency?: string; fx_rate?: string | null; branch_code?: string; warehouse_id?: string | null; grand_total_thb?: string | null; vat_thb?: string | null; base_thb?: string | null }
