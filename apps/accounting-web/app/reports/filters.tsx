'use client';
// แถบตัวกรองของ ScreenReports.dc.html — เปลี่ยนค่าแล้วโหลดรายงานใหม่ผ่าน query (?view=&range=&cmp=&level=)
// TODO(Wei) ScreenReports.dc.html: "ไตรมาส" / "กำหนดเอง…" / เปรียบเทียบ "งบประมาณ" / แยกคอลัมน์ตามสาขา-รายเดือน / รวมรายการร่าง — ยังไม่มีข้อมูลงบประมาณ/มิติ และ GL ไม่รวมร่าง จึงปิดไว้ (disabled)
import { css } from '@innovera/ui';
import { useRouter } from 'next/navigation';

const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const FIELD = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px';

export interface ReportQuery { view: string; range: 'ytd' | 'month'; cmp: 'prior' | 'none'; level: 'sub' | 'summary' | 'all' }

export function ReportFilters({ base, q, year, monthLabel }: { base: string; q: ReportQuery; year: number; monthLabel: string }) {
  const router = useRouter();
  const go = (p: Partial<ReportQuery>) => {
    const n = { ...q, ...p };
    router.push(`${base}?view=${n.view}&range=${n.range}&cmp=${n.cmp}&level=${n.level}`);
  };
  return (
    <div style={css('display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; font-size: 14px')}>
      <label style={css(LABEL)}>งวด<select value={q.range} onChange={(e) => go({ range: e.target.value as ReportQuery['range'] })} style={css(FIELD)}>
        <option value="ytd">ปีบัญชี {year} สะสมถึง {monthLabel}</option><option value="month">เดือน {monthLabel} {year}</option><option disabled>ไตรมาส 4/{year}</option><option disabled>กำหนดเอง…</option>
      </select></label>
      <label style={css(LABEL)}>เปรียบเทียบ<select value={q.cmp} onChange={(e) => go({ cmp: e.target.value as ReportQuery['cmp'] })} style={css(FIELD)}>
        <option value="prior">งวดเดียวกันปีก่อน</option><option disabled>งบประมาณ</option><option value="none">ไม่เปรียบเทียบ</option>
      </select></label>
      <label style={css(LABEL)}>แสดงแยกคอลัมน์ตาม<select style={css(FIELD)}><option>รวมทั้งบริษัท</option><option disabled>สาขา</option><option disabled>รายเดือน (12 คอลัมน์)</option></select></label>
      <label style={css(LABEL)}>ระดับ<select value={q.level} onChange={(e) => go({ level: e.target.value as ReportQuery['level'] })} style={css(FIELD)}>
        <option value="sub">หมวดย่อย</option><option value="summary">สรุป</option><option value="all">ทุกบัญชี</option>
      </select></label>
      <label style={css('display: flex; align-items: center; gap: 8px; height: 40px')}><input type="checkbox" disabled /> รวมรายการที่ยังไม่ผ่านรายการ (ร่าง)</label>
    </div>
  );
}
