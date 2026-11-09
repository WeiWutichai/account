// G5 ตั้งค่าเอกสาร — design/project/ScreenDocSettings.dc.html
// รูปแบบเลขที่: จาก GET doc-settings (ไม่มีแถว = ค่าตั้งต้นของตัวสร้างเลขที่) · ลำดับปัจจุบัน = GET doc-settings/counters (acct.number_series เดือนนี้)
import { api } from '../../lib/api';
import { Shell } from '../../lib/shell';
import { currentSeq, formatNo, RESET_LABEL, SERIES, settingOf, shownPattern, type Counter, type DocSetting } from './_series';
import { DocSettingsView, type SeriesRow } from './view';

const today = (): string => process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10);

export default async function DocSettingsPage() {
  const [settings, counters] = await Promise.all([api<DocSetting[]>('/v1/doc-settings'), api<Counter[]>('/v1/doc-settings/counters')]);
  const iso = today();
  const rows: SeriesRow[] = SERIES.map((def) => {
    const has = settings.some((s) => s.doc_type === def.key);
    if (def.key === 'IV-00001' && !has) return { key: def.key, label: def.label, branch: def.branch, pattern: '—', reset: '—', next: '—', current: '—' };
    const pattern = def.types.map((t) => shownPattern(settingOf(settings, t), def.rawPattern)).join(' · ') + (def.extra ?? '');
    const seqs = def.seqTypes.map((t) => { const s = settingOf(settings, t); const n = currentSeq(s, counters); return { next: formatNo(s.pattern, s.prefix, iso, n + 1), cur: String(n) }; });
    return {
      key: def.key, label: def.label, branch: def.branch, pattern, reset: RESET_LABEL[settingOf(settings, def.types[0]!).reset],
      next: def.noData || !seqs.length ? '—' : seqs.map((x) => x.next).join(' · '), current: def.noData || !seqs.length ? '—' : seqs.map((x) => x.cur).join(' · '),
    };
  });
  return (
    <Shell active="docsettings">
      <DocSettingsView rows={rows} settings={settings} />
    </Shell>
  );
}
