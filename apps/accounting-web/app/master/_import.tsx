'use client';
// ปุ่ม "นำเข้า Excel" ของ ScreenContacts / ScreenProducts — เลือกไฟล์ → ตรวจ (POST /v1/master/:kind/import) → แสดงผลในหน้า → ยืนยันนำเข้า (?commit=1)
// TODO(Wei) ScreenContacts.dc.html / ScreenProducts.dc.html: ไม่มีแบบร่างหน้าตรวจไฟล์ก่อนนำเข้า — แสดงผลในกรอบข้อความเดิม (Msg) + ปุ่ม "นำเข้า" / "ยกเลิก" + ลิงก์แม่แบบ
import { Button, css } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

interface Result { ok: boolean; committed: boolean; rows: { row: number; code: string; name: string; action: 'create' | 'update' }[]; issues: { row: number; message: string }[]; error?: string }
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_ISSUES = 10;

export function useExcelImport(kind: 'contacts' | 'products') {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(f: File, commit: boolean) {
    setBusy(true);
    try {
      const r = await fetch(`/api/proxy/master/${kind}/import${commit ? '?commit=1' : ''}`, { method: 'POST', headers: { 'content-type': XLSX }, body: f });
      const j = (await r.json().catch(() => ({}))) as Partial<Result> & { error?: string };
      setRes(r.ok ? { ok: !!j.ok, committed: !!j.committed, rows: j.rows ?? [], issues: j.issues ?? [] } : { ok: false, committed: false, rows: [], issues: [], error: j.error ?? `ผิดพลาด (${r.status})` });
      if (r.ok && j.committed) { setFile(null); router.refresh(); }
    } catch {
      setRes({ ok: false, committed: false, rows: [], issues: [], error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' });
    } finally {
      setBusy(false);
    }
  }
  const pick = (f: File | undefined) => { if (!f) return; setFile(f); void send(f, false); if (input.current) input.current.value = ''; };
  const close = () => { setFile(null); setRes(null); };

  const button = (
    <>
      <input ref={input} type="file" accept=".xlsx" hidden aria-hidden="true" onChange={(e) => pick(e.target.files?.[0])} />
      <Button size={36} disabled={busy} onClick={() => input.current?.click()}>นำเข้า Excel</Button>
    </>
  );

  const created = res?.rows.filter((r) => r.action === 'create').length ?? 0;
  const updated = (res?.rows.length ?? 0) - created;
  const text = !res ? (busy ? 'กำลังตรวจไฟล์…' : null)
    : res.error ? res.error
    : res.committed ? `นำเข้าแล้ว ${res.rows.length} แถว · เพิ่มใหม่ ${created} · แก้ไข ${updated}`
    : res.issues.length ? `ไฟล์มีข้อผิดพลาด ${res.issues.length} แถว — ยังไม่ได้นำเข้า: ${res.issues.slice(0, MAX_ISSUES).map((i) => (i.row ? `แถว ${i.row}: ${i.message}` : i.message)).join(' · ')}${res.issues.length > MAX_ISSUES ? ' …' : ''}`
    : `ตรวจแล้ว ${res.rows.length} แถว · เพิ่มใหม่ ${created} · แก้ไข ${updated} (ช่องว่างคงค่าเดิม)`;
  const panel = text === null ? null : (
    <div role="status" style={css(`padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid ${res && (res.ok || res.committed) ? '#24a148' : res ? '#da1e28' : '#0f62fe'}; font-size: 14px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap`)}>
      <span style={css('flex: 1 1 320px')}>{file && !res?.committed ? `${file.name} · ` : ''}{text}{' '}
        <a href={`/api/proxy/master/${kind}/import/template`}>แม่แบบ Excel</a></span>
      {res?.ok && !res.committed && file && <Button size={32} kind="primary" disabled={busy} onClick={() => void send(file, true)}>นำเข้า</Button>}
      {!busy && <Button size={32} kind="ghost" onClick={close}>{res?.ok && !res.committed ? 'ยกเลิก' : 'ปิด'}</Button>}
    </div>
  );
  return { button, panel };
}
