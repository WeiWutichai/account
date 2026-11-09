'use client';
// รายการบริษัท + ช่องค้นหา — design/project/ScreenCompanyPicker.dc.html
import { Button, ButtonLink, css, href } from '@innovera/ui';
import { useState } from 'react';

export interface Card { id: string; name: string; initials: string; sub: string; current: boolean; state: 'active' | 'readonly' | 'setup' }
export interface Group { orgId: string; title: string; planLink: boolean; member: boolean; cards: Card[] }

const ROW = 'display: grid; grid-template-columns: 48px minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) 120px; gap: 16px; align-items: center; padding: 16px; text-decoration: none; color: #161616';
const TAG = 'display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 4px; font-size: 13px; font-weight: 500; justify-self: end';
const DOT = 'width: 8px; height: 8px; border-radius: 999px; background: currentColor';

function Row({ c, first }: { c: Card; first: boolean }) {
  const border = `${first ? '' : 'border-top: 1px solid #e0e0e0; '}border-left: 3px solid ${c.current ? '#0f62fe' : 'transparent'}`;
  return (
    <a href={`/companies/select?id=${encodeURIComponent(c.id)}`} style={css(`${ROW}; ${border}`)}>
      <span style={css('width: 48px; height: 48px; background: #e0e0e0; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13px')}>{c.initials}</span>
      <div><div style={css('font-weight: 600')}>{c.name}</div><div style={css('font-size: 13px; color: #525252')}>{c.sub}</div></div>
      {c.state === 'active' ? (
        <>
          {/* TODO(M4–M6): งานรอคุณ / กำหนดใกล้ถึง มาจากโมดูลขาย ซื้อ ภาษี ที่ยังไม่สร้าง */}
          <div style={css('font-size: 13px')}><span style={css('color: #525252')}>งานรอคุณ</span><div style={css('font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums')}>—</div></div>
          <div style={css('font-size: 13px')}><span style={css('color: #525252')}>กำหนดใกล้ถึง</span><div style={css('font-variant-numeric: tabular-nums')}>—</div></div>
        </>
      ) : (
        <>
          <div style={css('font-size: 13px; color: #525252')}>—</div>
          <div style={css('font-size: 13px; color: #525252')}>—</div>
        </>
      )}
      {c.state === 'setup' && <span style={css(`${TAG}; background: #fcf4d6; color: #684e00`)}><span style={css(DOT)} />ตั้งค่าต่อ</span>}
      {c.state === 'readonly' && <span style={css(`${TAG}; background: #e0e0e0; color: #161616`)}><span style={css(DOT)} />อ่านอย่างเดียว</span>}
      {/* TODO(M7): ป้าย "TMS เชื่อมแล้ว" ต้องมาจากการเชื่อมแอปจริง (ScreenApps) — ยังไม่มีข้อมูล จึงเว้นว่างแทนการแสดงสถานะที่ไม่จริง */}
      {c.state === 'active' && <span />}
    </a>
  );
}

export function CompanyList({ groups, companyCount, planHref }: { groups: Group[]; companyCount: number; planHref: string }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = groups.map((g) => ({ ...g, cards: needle ? g.cards.filter((c) => c.name.toLowerCase().includes(needle)) : g.cards })).filter((g) => g.cards.length > 0);
  return (
    <div style={css('width: 100%; max-width: 960px; display: flex; flex-direction: column; gap: 24px')}>
      <div style={css('display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 12px')}>
        <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>เลือกบริษัทที่จะทำงาน</h1><span style={css('font-size: 13px; color: #525252')}>คุณมีสิทธิ์ใน {companyCount} บริษัท ใน {groups.length} องค์กร · สลับบริษัทได้ตลอดจากมุมซ้ายบน</span></div>
        <div style={css('display: flex; gap: 8px')}>
          <input placeholder="ค้นหาบริษัท" aria-label="ค้นหาบริษัท" value={q} onChange={(e) => setQ(e.target.value)} style={css('height: 40px; width: 240px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #ffffff; font-family: inherit; font-size: 14px')} />
          <ButtonLink href={href('companyCreate')} kind="primary">+ สร้างบริษัทใหม่</ButtonLink>
        </div>
      </div>

      {shown.map((g) => (
        <section key={g.orgId} style={css('display: flex; flex-direction: column; gap: 8px')}>
          {g.planLink
            ? <div style={css('font-size: 13px; color: #525252; display: flex; justify-content: space-between')}><span>{g.title}</span><a href={planHref} style={css('text-decoration: none')}>จัดการแผนและบิล</a></div>
            : <div style={css('font-size: 13px; color: #525252')}>{g.title}</div>}
          <div style={css('background: #ffffff; border: 1px solid #e0e0e0')}>
            {g.cards.map((c, i) => <Row key={c.id} c={c} first={i === 0} />)}
          </div>
        </section>
      ))}

      <section style={css('background: #ffffff; border: 1px solid #e0e0e0; padding: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; font-size: 14px')}>
        <div><strong>มุมมองรวมทุกบริษัท (Group view)</strong><div style={css('font-size: 13px; color: #525252')}>กระแสเงินสด ลูกหนี้ เจ้าหนี้ และกำหนดยื่นภาษีของทุกบริษัทในหน้าเดียว · สำหรับเจ้าของและสำนักงานบัญชี</div></div>
        {/* TODO(M7): มุมมองรวม (Group view) ยังไม่มีหน้า/ข้อมูล — ปุ่มคงไว้ตามแบบร่าง */}
        <Button size={36}>เปิดมุมมองรวม</Button>
      </section>
    </div>
  );
}
