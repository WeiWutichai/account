// จำนวนเงินเป็นตัวอักษรภาษาไทย (แบบพิมพ์ D1–D11 · fixtures amount_text) เช่น 10700.00 → "หนึ่งหมื่นเจ็ดร้อยบาทถ้วน"
import type { MoneyString } from '@innovera/ledger';

const DIGIT = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACE = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** อ่านเลข 0–999,999 (ไม่มีคำว่า "ล้าน") */
function under1m(n: string): string {
  const d = n.replace(/^0+/u, '');
  let out = '';
  for (let i = 0; i < d.length; i++) {
    const v = Number(d[i]);
    const pos = d.length - i - 1;
    if (v === 0) continue;
    if (pos === 0 && v === 1 && d.length > 1) out += 'เอ็ด';
    else if (pos === 1 && v === 2) out += 'ยี่';
    else if (pos === 1 && v === 1) out += '';
    else out += DIGIT[v];
    out += PLACE[pos];
  }
  return out;
}
/** อ่านจำนวนเต็มบวกใด ๆ (หลักล้านซ้อนได้) */
export function thaiNumber(int: string): string {
  const d = int.replace(/^0+/u, '') || '0';
  if (d === '0') return 'ศูนย์';
  const groups: string[] = [];
  for (let end = d.length; end > 0; end -= 6) groups.unshift(d.slice(Math.max(0, end - 6), end));
  return groups.map((g, i) => {
    const t = under1m(g);
    return t + (i < groups.length - 1 ? (t || i > 0 ? 'ล้าน' : '') : '');
  }).join('');
}

export function bahtText(amount: MoneyString): string {
  const neg = amount.startsWith('-');
  const [i = '0', f = '00'] = (neg ? amount.slice(1) : amount).split('.');
  const satang = (f + '00').slice(0, 2);
  const baht = /^0*$/u.test(i) ? '' : `${thaiNumber(i)}บาท`;
  const tail = satang === '00' ? (baht ? 'ถ้วน' : 'ศูนย์บาทถ้วน') : `${thaiNumber(satang)}สตางค์`;
  return `${neg ? 'ลบ' : ''}${baht}${tail}`;
}
