// G5 แก้ไขชุดเลขที่เอกสาร — design/project/ScreenDocSeriesEdit.dc.html
// TODO(Wei): แบบร่างเขียนตัวแปรเป็น {{YY}} ซึ่งเครื่องมือแบบร่างแสดงเป็นช่องว่าง ("IV-", "ตัวแปร: / พ.ศ. …") — หน้าจอใช้ {YY} ตามที่ ScreenDocSettings.dc.html เขียน
// TODO(API): "ประวัติชุดเลขที่นี้" — ยังไม่มี API ประวัติการแก้ชุดเลขที่ (audit ของ doc_setting) จึงแสดงเฉพาะครั้งล่าสุดที่บันทึก (updated_at)
import { notFound } from 'next/navigation';
import { api } from '../../../../lib/api';
import { Shell } from '../../../../lib/shell';
import { currentSeq, seriesDef, settingOf, type Counter, type DocSetting } from '../../_series';
import { SeriesForm } from './form';

const today = (): string => process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10);

export default async function SeriesEditPage({ params }: { params: Promise<{ type: string }> }) {
  const key = decodeURIComponent((await params).type);
  const def = seriesDef(key);
  if (!def) notFound();
  const [settings, counters, docs] = await Promise.all([
    api<DocSetting[]>('/v1/doc-settings'),
    api<Counter[]>('/v1/doc-settings/counters'),
    api<{ doc_type: string; doc_no: string | null; status: string }[]>('/v1/documents'),
  ]);
  const s = settingOf(settings, key);
  const iso = today();
  const mine = docs.filter((d) => def.types.includes(d.doc_type));
  const seq = def.noData ? null : currentSeq(s, counters);
  return (
    <Shell active="docsettings">
      <SeriesForm def={def} setting={s} saved={settings.some((x) => x.doc_type === key)} today={iso} currentSeq={seq}
        issued={def.noData || def.key === 'JV' ? null : mine.filter((d) => d.doc_no).length} drafts={def.noData || def.key === 'JV' ? null : mine.filter((d) => !d.doc_no && d.status !== 'voided').length} />
    </Shell>
  );
}
