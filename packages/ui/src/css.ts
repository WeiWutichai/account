// แปลง style string จากแบบร่าง (design/project/*.dc.html) เป็น React style — คัดลอกจากแบบร่างได้ตรงตัว ไม่ต้องถอดมือ
import type { CSSProperties } from 'react';

const cache = new Map<string, CSSProperties>();

export function css(text: string): CSSProperties {
  const hit = cache.get(text);
  if (hit) return hit;
  const out: Record<string, string> = {};
  for (const decl of text.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const k = decl.slice(0, i).trim();
    const v = decl.slice(i + 1).trim();
    if (!k || !v) continue;
    out[k.startsWith('--') ? k : k.replace(/-([a-z])/gu, (_, c: string) => c.toUpperCase())] = v;
  }
  cache.set(text, out as CSSProperties);
  return out as CSSProperties;
}

/** รวม style string หลายชุด (ชุดหลังทับชุดก่อน) */
export const cx = (...parts: (string | false | null | undefined)[]): CSSProperties => css(parts.filter(Boolean).join('; '));
