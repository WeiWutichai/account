// ฝั่ง client → /api/console/<path> (proxy same-origin · token อยู่ใน cookie httpOnly)
export async function api<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api/console/${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store' });
  const text = await res.text();
  const data = (text ? JSON.parse(text) : {}) as T & { error?: string; message?: string | string[] };
  if (!res.ok) throw new Error(data.error ?? (Array.isArray(data.message) ? data.message.join(', ') : data.message) ?? `Console API ${res.status}`);
  return data;
}

/** เซสชันเข้าดูที่เปิดอยู่ของผู้ใช้ในเบราว์เซอร์นี้ (แถบแดงบนทุกหน้า) */
// TODO(backend): ไม่มี GET /console/v1/access (รายการคำขอ + สถานะ + ends_at ของ ticket) — จึงจำ access id ไว้ในเบราว์เซอร์ชั่วคราว
export interface AccessState { id: string; ticketId: string; status: 'pending' | 'approved' | 'denied' | 'active' | 'ended'; minutes: 30 | 60; scope: string; reason: string; write: boolean; endsAt?: string; org: string }
const KEY = 'console.access.v1';
export const ACCESS_EVENT = 'console-access';
export function loadAccess(): Record<string, AccessState> {
  try { return JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Record<string, AccessState>; } catch { return {}; }
}
export function saveAccess(all: Record<string, AccessState>): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage ปิดอยู่ — ใช้ state ในหน้าแทน */ }
  window.dispatchEvent(new Event(ACCESS_EVENT));
}
export function activeAccess(all: Record<string, AccessState>, now = Date.now()): AccessState | undefined {
  return Object.values(all).find((a) => a.status === 'active' && a.endsAt && new Date(a.endsAt).getTime() > now);
}
