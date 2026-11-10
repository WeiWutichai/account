// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// เรียก accounting-api ฝั่ง client ผ่าน /api/proxy (รองรับ DELETE) · error = ข้อความไทยจาก API ({ error })
export type Res<T> = { ok: true; data: T } | { ok: false; error: string };

export async function req<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown): Promise<Res<T>> {
  try {
    const res = await fetch(`/api/proxy/${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    const j = (await res.json().catch(() => ({}))) as T & { error?: string | string[]; message?: string | string[] };
    if (!res.ok) {
      const e = j.error ?? j.message;
      return { ok: false, error: (Array.isArray(e) ? e.join(' · ') : e) ?? `ผิดพลาด (${res.status})` };
    }
    return { ok: true, data: j };
  } catch {
    return { ok: false, error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' };
  }
}
