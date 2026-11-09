// เรียก accounting-api จากฝั่ง client ผ่าน /api/proxy (same-origin · cookie session) · error = { error: '<ไทย>' }
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export async function call<T>(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(`/api/proxy/${path}`, {
      method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const j = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string | string[] };
    if (!res.ok) return { ok: false, error: j.error ?? (Array.isArray(j.message) ? j.message.join(', ') : j.message) ?? `ผิดพลาด (${res.status})` };
    return { ok: true, data: j };
  } catch {
    return { ok: false, error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' };
  }
}
