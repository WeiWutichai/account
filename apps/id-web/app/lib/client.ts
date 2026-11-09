// เรียก id-api จากเบราว์เซอร์ผ่าน proxy same-origin (/api/id/…) · error ของ API เป็น { error: '<ข้อความไทย>' }
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code?: string };

export async function call<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api/id/${path.replace(/^\//u, '')}`, {
      method, credentials: 'same-origin', ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const text = await res.text();
    const json = (text ? JSON.parse(text) : {}) as T & { error?: string; code?: string };
    if (!res.ok) return { ok: false, status: res.status, error: json.error ?? `เกิดข้อผิดพลาด (${res.status})`, ...(json.code ? { code: json.code } : {}) };
    return { ok: true, data: json };
  } catch {
    return { ok: false, status: 0, error: 'เชื่อมต่อระบบไม่ได้ — ลองใหม่อีกครั้ง' };
  }
}

/** ขั้นถัดไปหลังเข้าสู่ระบบ/ยืนยัน (คำตอบ next ของ id-api) → URL ของหน้าถัดไป */
export function nextUrl(step: string, opts: { next: string | null; dest: string; trust?: boolean }): string {
  const q = opts.next ? `next=${encodeURIComponent(opts.next)}` : '';
  switch (step) {
    case 'verify': return `/verify-email${q ? `?${q}` : ''}`;
    case 'mfa': return `/2fa?stage=mfa${opts.trust === false ? '&trust=0' : ''}${q ? `&${q}` : ''}`;
    case 'setup': return `/2fa?stage=setup${q ? `&${q}` : ''}`;
    default: return opts.dest;
  }
}
