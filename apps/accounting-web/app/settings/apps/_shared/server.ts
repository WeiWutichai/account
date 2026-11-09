// โหลดข้อมูล M7 ฝั่ง server · ไม่มีสิทธิ์ (403) → แสดงข้อความในหน้าแทนการพังทั้งหน้า
import 'server-only';
import { api } from '../../../lib/api';
import { loadUsers } from '../../users/data';

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

export async function load<T>(path: string): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await api<T>(path) };
  } catch (e) {
    // redirect() ของ next (401/เลือกบริษัท) ต้องโยนต่อ
    if (e instanceof Error && /NEXT_REDIRECT/u.test(e.message)) throw e;
    if (e && typeof e === 'object' && 'digest' in e) throw e;
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** user id → ชื่อที่แสดง (จาก Innovera ID) · ไม่มีสิทธิ์ดูรายชื่อ → map ว่าง (แสดง id ย่อ) */
export async function userNames(): Promise<Record<string, string>> {
  try {
    const { data } = await loadUsers();
    return Object.fromEntries(data.users.map((u) => [u.id, u.display_name]));
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e) throw e;
    return {};
  }
}
