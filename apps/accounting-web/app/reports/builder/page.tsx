// R2 ตัวสร้างรูปแบบงบ — design/project/ScreenReportBuilder.dc.html (Sidebar active="reports")
// TODO(Phase 2): PLAN.md ระบุตัวสร้างรูปแบบงบ 18 คอลัมน์อยู่นอกขอบเขต P1 — หน้านี้แสดงตามแบบร่างเท่านั้น (ยังไม่ทำงาน) · ตาราง acct.report_format มีแล้วแต่ยังไม่มี logic/API
// ตัวเลขในกล่อง "ตัวอย่าง" คัดลอกจากแบบร่าง (ยังไม่มีมิติ project ในข้อมูล) — TODO(Phase 2): คำนวณจาก GL ตามรูปแบบที่บันทึก
// หมายเหตุ: ไม่มี id ใน packages/ui/src/routes.ts สำหรับหน้านี้ — ใช้ /reports/builder (ลิงก์จากเมนู "รูปแบบที่กำหนดเอง" ใน ScreenReports)
import { buttonStyle, css } from '@innovera/ui';
import { Shell } from '../../lib/shell';

const TH = 'padding: 0 12px; font-weight: 400';
const MONO = "padding: 0 12px; font-family: 'IBM Plex Mono', monospace; font-size: 13px";
const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const FIELD = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px';
const N = 'padding: 0 8px; text-align: right; font-variant-numeric: tabular-nums';

// [#, ชื่อบรรทัด, ชนิด, ที่มา, รูปแบบ, แบบแถว]
const LINES: [string, string, string, string, string, 'head' | 'item' | 'total' | 'note'][] = [
  ['10', 'รายได้', 'หัวข้อ', '', 'ตัวหนา', 'head'],
  ['20', 'รายได้ค่าขนส่ง', 'ช่วงบัญชี', '4100000 – 4199999', 'Cr เป็นบวก', 'item'],
  ['30', 'รายได้อื่น', 'ช่วงบัญชี', '4200000 – 4999999', 'Cr เป็นบวก', 'item'],
  ['40', 'รวมรายได้', 'สูตร', '=L20+L30', 'เส้นบน · หนา', 'total'],
  ['50', 'ต้นทุนต่อโครงการ', 'หัวข้อ', '', '', 'head'],
  ['60', 'ค่าจ้างผู้รับเหมา', 'ช่วงบัญชี', '5110000 – 5119999', 'Dr เป็นลบ (วงเล็บ)', 'item'],
  ['70', 'ค่าเดินทางและวัสดุ', 'ช่วงบัญชี', '5120000 – 5139999', 'Dr เป็นลบ', 'item'],
  ['80', 'ค่าเสื่อมราคาอุปกรณ์', 'บัญชีเดียว', '5150100', 'Dr เป็นลบ', 'item'],
  ['90', 'กำไรต่อโครงการ', 'สูตร', '=L40+L60+L70+L80', 'เส้นคู่ · หนา', 'head'],
  ['100', 'กำไรต่อโครงการ % ของรายได้', 'สูตร', '=L90/L40*100', 'ร้อยละ 1 ตำแหน่ง', 'note'],
];
const COLS: [string, string, string, string][] = [
  ['C1', 'PRJ-07 [ลูกค้า A]', 'งวดที่เลือก', 'project = PRJ-07'],
  ['C2', 'PRJ-09 [ลูกค้า B]', 'งวดที่เลือก', 'project = PRJ-09'],
  ['C3', 'PRJ-11 [ลูกค้า C]', 'งวดที่เลือก', 'project = PRJ-11'],
  ['C4', 'โครงการอื่น ๆ', 'งวดที่เลือก', 'project ไม่อยู่ใน C1–C3'],
  ['C5', 'ไม่ระบุโครงการ', 'งวดที่เลือก', 'project ว่าง'],
];
const PREVIEW: [string, string, string, string, 'total' | 'item' | 'pct'][] = [
  ['รวมรายได้', '486,200', '412,900', '3,614,800', 'total'],
  ['ค่าจ้างผู้รับเหมา', '(142,300)', '(128,600)', '(1,014,200)', 'item'],
  ['ค่าเดินทางและวัสดุ', '(38,400)', '(61,250)', '(312,050)', 'item'],
  ['ค่าเสื่อมราคาอุปกรณ์', '(25,000)', '(25,000)', '(200,000)', 'item'],
  ['กำไรต่อโครงการ', '280,500', '198,050', '2,088,550', 'total'],
  ['% ของรายได้', '57.7', '48.0', '57.8', 'pct'],
];

export default function ReportBuilderPage() {
  return (
    <Shell active="reports">
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>รายงาน / รูปแบบที่กำหนดเอง / งบกำไรขาดทุนแยกตามโครงการ</span>
        <span style={css('display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 4px; background: #edf5ff; color: #0043ce; font-size: 13px; font-weight: 500')}><span style={css('width: 8px; height: 8px; border-radius: 999px; background: currentColor')} />แก้ไขอยู่ · ยังไม่บันทึก</span>
      </header>
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 16px')}>
        <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>ตัวสร้างรูปแบบงบ — งบกำไรขาดทุนแยกตามโครงการ</h1><span style={css('font-size: 13px; color: #525252')}>กำหนดบรรทัด (ช่วงบัญชี / สูตร) และคอลัมน์ (งวด / มิติ) ได้สูงสุด 18 คอลัมน์ · ใช้แทนการทำใน Excel ทุกเดือน</span></div>
        <div style={css('display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 24px; align-items: start')}>
          <section style={css('display: flex; flex-direction: column; gap: 16px')}>
            <div style={css('border: 1px solid #e0e0e0')}>
              <div style={css('display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}><strong style={css('font-weight: 600')}>บรรทัด (แถว)</strong><div style={css('display: flex; gap: 8px')}><button type="button" style={buttonStyle('secondary', 32)}>+ หัวข้อ</button><button type="button" style={buttonStyle('secondary', 32)}>+ ช่วงบัญชี</button><button type="button" style={buttonStyle('secondary', 32)}>+ สูตร</button></div></div>
              <table style={css('width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
                <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 36px; width: 32px')}><span style={css('position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)')}>ลาก</span></th><th style={css(`${TH}; width: 48px`)}>#</th><th style={css(TH)}>ชื่อบรรทัด</th><th style={css(TH)}>ชนิด</th><th style={css(TH)}>ที่มา</th><th style={css(TH)}>รูปแบบ</th></tr></thead>
                <tbody>
                  {LINES.map(([no, name, kind, src, fmt, row]) => (
                    <tr key={no} style={css(`border-top: 1px solid #e0e0e0${row === 'total' ? '; background: #e0e0e0' : ''}`)}>
                      <td style={css('height: 36px; text-align: center; color: #8d8d8d; cursor: grab')}>⋮⋮</td>
                      <td style={css('padding: 0 12px; font-variant-numeric: tabular-nums')}>{no}</td>
                      <td style={css(row === 'head' || row === 'total' ? 'padding: 0 12px; font-weight: 600' : row === 'note' ? 'padding: 0 12px; padding-left: 28px; color: #525252' : 'padding: 0 12px; padding-left: 28px')}>{name}</td>
                      <td style={css('padding: 0 12px; color: #525252')}>{kind}</td>
                      <td style={css(kind === 'สูตร' ? MONO : src ? 'padding: 0 12px; font-variant-numeric: tabular-nums' : 'padding: 0 12px')}>{src}</td>
                      <td style={css(fmt ? 'padding: 0 12px; color: #525252' : 'padding: 0 12px')}>{fmt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={css('border: 1px solid #e0e0e0')}>
              <div style={css('display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}><strong style={css('font-weight: 600')}>คอลัมน์ (ใช้ 6 จาก 18)</strong><button type="button" style={buttonStyle('secondary', 32)}>+ คอลัมน์</button></div>
              <table style={css('width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
                <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css(`height: 36px; ${TH}; width: 48px`)}>#</th><th style={css(TH)}>หัวคอลัมน์</th><th style={css(TH)}>งวด</th><th style={css(TH)}>กรองมิติ</th></tr></thead>
                <tbody>
                  {COLS.map(([c, head, per, filter]) => (
                    <tr key={c} style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 36px; padding: 0 12px; font-variant-numeric: tabular-nums')}>{c}</td><td style={css('padding: 0 12px')}>{head}</td><td style={css('padding: 0 12px')}>{per}</td><td style={css('padding: 0 12px')}>{filter}</td></tr>
                  ))}
                  <tr style={css('border-top: 1px solid #e0e0e0; background: #e0e0e0')}><td style={css('height: 36px; padding: 0 12px; font-variant-numeric: tabular-nums')}>C6</td><td style={css('padding: 0 12px; font-weight: 600')}>รวม</td><td style={css(MONO)}>=C1+C2+C3+C4+C5</td><td style={css('padding: 0 12px')}></td></tr>
                </tbody>
              </table>
            </div>
          </section>
          <aside style={css('display: flex; flex-direction: column; gap: 16px')}>
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; display: flex; flex-direction: column; gap: 12px; font-size: 14px')}>
              <strong>คุณสมบัติของรูปแบบ</strong>
              <label style={css(LABEL)}>ชื่อรูปแบบ<input defaultValue="งบกำไรขาดทุนแยกตามโครงการ" style={css(FIELD)} /></label>
              <label style={css(LABEL)}>ประเภท<select style={css(FIELD)}><option>งบกำไรขาดทุน (ยอดเคลื่อนไหวในงวด)</option><option>งบแสดงฐานะการเงิน (ยอดคงเหลือ ณ วันที่)</option><option>ตารางวิเคราะห์ (ผสม)</option></select></label>
              <label style={css(LABEL)}>มิติหลักของคอลัมน์<select style={css(FIELD)}><option>project (โครงการ)</option><option>branch (สาขา)</option><option>costcenter (ศูนย์ต้นทุน)</option><option>vehicle / trip (เมื่อเชื่อม TMS)</option><option>ไม่ใช้มิติ</option></select></label>
              <label style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" defaultChecked /> ซ่อนบรรทัดที่เป็นศูนย์ทุกคอลัมน์</label>
              <label style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" defaultChecked /> แสดงตัวเลขเป็นหลักพัน (ตัด ,000) เมื่อพิมพ์</label>
              <label style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" /> แชร์ให้ทุกคนในบริษัท</label>
            </section>
            <section style={css('background: #f4f4f4; border: 1px solid #e0e0e0')}>
              <div style={css('display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e0e0e0')}><strong style={css('font-weight: 600')}>ตัวอย่าง (พ.ย. 2569)</strong><span style={css('font-size: 13px; color: #525252')}>3 คอลัมน์แรก</span></div>
              <table style={css('width: 100%; border-collapse: collapse; font-size: 13px; line-height: 18px')}>
                <thead><tr style={css('color: #525252')}><th style={css('height: 32px; padding: 0 12px; text-align: left; font-weight: 400')}><span style={css('position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)')}>บรรทัด</span></th><th style={css('padding: 0 8px; text-align: right; font-weight: 400')}>PRJ-07</th><th style={css('padding: 0 8px; text-align: right; font-weight: 400')}>PRJ-09</th><th style={css('padding: 0 8px; text-align: right; font-weight: 400')}>รวม</th></tr></thead>
                <tbody>
                  {PREVIEW.map(([label, a, b, t, row], i) => (
                    <tr key={label} style={css(row === 'total' ? `border-top: 1px solid ${i ? '#8d8d8d' : '#e0e0e0'}; font-weight: 600` : row === 'pct' ? 'color: #525252' : '')}>
                      <td style={css(row === 'total' ? 'height: 28px; padding: 0 12px' : 'height: 28px; padding: 0 12px 0 24px')}>{label}</td><td style={css(N)}>{a}</td><td style={css(N)}>{b}</td><td style={css(N)}>{t}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </aside>
        </div>
      </div>
      <div style={css('position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: space-between; align-items: center; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>ตรวจความครบ: บัญชี 5140000–5149999 (ค่าประกันภัย) ยังไม่อยู่ในบรรทัดใด</span>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}><button type="button" style={buttonStyle('secondary')}>เรียกดูเต็มจอ</button><button type="button" style={buttonStyle('primary')}>บันทึกรูปแบบ</button></div>
      </div>
    </Shell>
  );
}
