// หน้าที่ยังไม่ได้สร้าง — บอกตรงๆ ว่าจะเปิดใช้ใน milestone ไหน (docs/page-map.md) แทน 404
import { ROUTES, S, TopBar, css } from '@innovera/ui';
import { notFound } from 'next/navigation';
import { Shell } from '../lib/shell';

export default async function Pending({ params }: { params: Promise<{ slug: string[] }> }) {
  const path = `/${(await params).slug.join('/')}`;
  const r = ROUTES.find((x) => x.path === path);
  if (!r) notFound();
  return (
    <Shell active={r.id}>
      <TopBar crumb={r.design} />
      <div style={css(S.content)}>
        <h1 style={css(S.h1)}>หน้านี้ยังไม่เปิดใช้</h1>
        <p style={css(S.note)}>หน้า {r.design} อยู่ใน {r.milestone} ตามแผน (docs/page-map.md)</p>
      </div>
    </Shell>
  );
}
