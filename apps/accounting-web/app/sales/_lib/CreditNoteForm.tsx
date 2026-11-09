'use client';
// S5 ใบลดหนี้ / ใบเพิ่มหนี้ — design/project/ScreenCreditNote.dc.html (CN อ้างใบกำกับเดิม · สูตร CN[ref IV] / DN[ref IV])
import { Button, ButtonLink, css, money, parseThaiDate, thaiDate } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { call } from './client.ts';
import { docNo, type DocDetail, type DocLine, type DocRow, statusTag } from './doc.ts';
import { JournalPreview } from './JournalPreview';
import { blankLine, linePayload, type LineRow, priceText, rowFromLine, useTotals, validRow } from './lines.ts';
import { parseDec, qtyText, qtyTimesPrice, subMoney, sumMoney } from './num.ts';
import { DocHeader, F, Msg } from './ui';

type Kind = 'CN' | 'DN';
const REASONS = ['รับคืนสินค้าเนื่องจากชำรุด', 'ลดราคาเพราะสินค้าไม่ตรงตามที่ตกลง', 'คำนวณราคาผิดพลาดสูงกว่าที่เป็นจริง', 'ยกเลิกบริการบางส่วน'] as const;
interface RefRow { line: DocLine; reduce: string }

const refLabel = (r: { doc_no: string | null; issue_date: string; grand_total: string }) => `${r.doc_no ?? '(ร่าง)'} · ${thaiDate(r.issue_date)} · ${money(r.grand_total)}`;

export function CreditNoteForm({ detail, refDetail, invoices, names, today, kind: initialKind, noRef }: {
  detail: DocDetail | null; refDetail: DocDetail | null; invoices: DocRow[]; names: Record<string, string>; today: string; kind: Kind; noRef: boolean;
}) {
  const router = useRouter();
  const d = detail?.doc ?? null;
  const editable = !d || d.status === 'draft' || d.status === 'pending_approval';
  const [id, setId] = useState<string | null>(d?.id ?? null);
  const [kind, setKind] = useState<Kind>((d?.doc_type as Kind | undefined) ?? initialKind);
  const [ref, setRef] = useState<DocDetail | null>(refDetail);
  const [refText, setRefText] = useState(refDetail ? refLabel(refDetail.doc) : '');
  const [date, setDate] = useState(thaiDate(d?.issue_date ?? today));
  const [apply, setApply] = useState<'now' | 'later'>('now');
  const [reason, setReason] = useState(d?.reference ?? (initialKind === 'CN' ? REASONS[0] : ''));
  const [desc, setDesc] = useState(d?.notes ?? '');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // CN: แถวจากใบกำกับเดิม + จำนวนที่ลด · DN/ไม่อ้างอิง: บรรทัดอิสระ
  const fromRef = (r: DocDetail | null, own: DocDetail | null): RefRow[] => {
    const lines = r?.lines.filter((l) => l.line_type === 'item') ?? [];
    const mine = own?.lines.filter((l) => l.line_type === 'item') ?? [];
    const rows: RefRow[] = lines.map((l) => {
      const hit = mine.find((m) => m.product_code === l.product_code && m.unit_price === l.unit_price);
      return { line: l, reduce: hit ? qtyText(hit.qty).replace(/,/gu, '') : '0' };
    });
    // บรรทัดของใบลดหนี้ที่ไม่ตรงกับใบเดิม — แสดงต่อท้าย (จำนวนเดิม = —)
    for (const m of mine) if (!lines.some((l) => l.product_code === m.product_code && l.unit_price === m.unit_price)) rows.push({ line: { ...m, qty: null }, reduce: qtyText(m.qty).replace(/,/gu, '') });
    return rows;
  };
  const [refRows, setRefRows] = useState<RefRow[]>(fromRef(refDetail, detail));
  const [free, setFree] = useState<LineRow[]>(detail?.lines.filter((l) => l.line_type === 'item').map(rowFromLine) ?? [blankLine()]);
  const useFree = kind === 'DN' || noRef;

  useEffect(() => { if (!d) setRefRows(fromRef(ref, null)); }, [ref]);

  async function pickRef(text: string) {
    setRefText(text);
    const hit = invoices.find((x) => x.doc_no && text.startsWith(x.doc_no));
    if (!hit || hit.id === ref?.doc.id) return;
    const r = await call<DocDetail>(`documents/${hit.id}`);
    if (r.ok) setRef(r.data); else setMsg({ kind: 'err', text: r.error });
  }

  const cnRows: LineRow[] = refRows.filter((r) => (parseDec(r.reduce, 4) ?? 0n) > 0n).map((r) => ({
    item: `${r.line.product_code ? `${r.line.product_code} ` : ''}${r.line.description}`, account: r.line.account_code ?? '', qty: r.reduce, price: priceText(r.line.unit_price), disc: '', vat: r.line.vat_rate !== null,
  }));
  const rows = useFree ? free : cnRows;
  const { totals, err } = useTotals(rows, ref?.doc.price_incl_vat ?? false, '');
  const rule = noRef ? 'CN[no-ref]' : kind === 'DN' ? 'DN[ref IV]' : 'CN[ref IV]';

  const body = () => ({
    docType: kind, contactId: ref?.doc.contact_id ?? d?.contact_id ?? '', issueDate: parseThaiDate(date), priceInclVat: ref?.doc.price_incl_vat ?? false, ruleCode: rule,
    refDocumentId: noRef ? null : (ref?.doc.id ?? null), reference: reason || null, notes: desc || null, lines: rows.filter(validRow).map(linePayload),
  });
  // บันทึกล่าสุด — อนุมัติโดยไม่บันทึกซ้ำถ้าไม่มีการแก้
  const [saved, setSaved] = useState<string | null>(d ? JSON.stringify(body()) : null);
  async function save(): Promise<string | null> {
    if (!editable) return id;
    if (!parseThaiDate(date)) { setMsg({ kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return null; }
    const r = await call<{ id: string }>(id ? `documents/${id}` : 'documents', id ? 'PUT' : 'POST', body());
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return null; }
    setMsg({ kind: 'ok', text: 'บันทึกร่างแล้ว' });
    setSaved(JSON.stringify(body()));
    if (!id) { setId(r.data.id); router.replace(`/sales/credit-notes/${r.data.id}`); } else router.refresh();
    return r.data.id;
  }
  async function approve() {
    const docId = id && saved === JSON.stringify(body()) ? id : await save();
    if (!docId) return;
    const r = await call<{ docNo: string; journalNo?: string }>(`documents/${docId}/approve`, 'POST');
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: `อนุมัติแล้ว ${r.data.docNo}${r.data.journalNo ? ` · ลงบัญชี ${r.data.journalNo}` : ''}` });
    router.refresh();
  }

  const no = d ? docNo(d) : 'ใหม่';
  const name = kind === 'DN' ? 'ใบเพิ่มหนี้' : 'ใบลดหนี้';
  const net = totals?.net ?? '0.00';
  const original = ref?.doc.subtotal ?? '0.00';
  const corrected = kind === 'DN' ? sumMoney([original, net]) : subMoney(original, net);
  const after = ref?.outstanding ? (kind === 'DN' ? sumMoney([ref.outstanding, totals?.grandTotal]) : subMoney(ref.outstanding, totals?.grandTotal ?? '0.00')) : null;
  const tag = d ? statusTag({ ...d, outstanding: detail?.outstanding ?? null }, today) : { kind: 'info' as const, text: 'ร่าง' };
  const iso = parseThaiDate(date);
  const IN = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616';
  const setFreeRow = (i: number, k: keyof LineRow, v: string) => setFree(free.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  return (
    <>
      <DocHeader crumb={<>ขาย / <a href="/sales/credit-notes" style={css('text-decoration: none')}>{name}</a> / {no}{ref ? <> · อ้างอิง <a href={`/sales/invoices/${ref.doc.id}`}>{docNo(ref.doc)}</a></> : null}</>} tag={tag} />
      <div style={css(F.page)}>
        <div style={css('display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px')}>
          <h1 style={css(F.h1)}>{name} {no}</h1>
          <div role="group" aria-label="ประเภท" style={css('display: inline-flex; border: 1px solid #8d8d8d; border-radius: 4px; overflow: hidden')}>
            <button aria-pressed={kind === 'CN'} disabled={!editable} onClick={() => setKind('CN')} style={css(kind === 'CN' ? F.segOn : F.segOff)}>ลดหนี้ (CN)</button>
            <button aria-pressed={kind === 'DN'} disabled={!editable} onClick={() => setKind('DN')} style={css(kind === 'DN' ? F.segOn : F.segOff)}>เพิ่มหนี้ (DN)</button>
          </div>
        </div>
        <section style={css(F.grid)}>
          <datalist id="cn-ref">{invoices.map((x) => <option key={x.id} value={refLabel(x)} />)}</datalist>
          <label style={css(F.label2)}>อ้างอิงใบกำกับเดิม<input list="cn-ref" readOnly={!editable || noRef} value={refText} onChange={(e) => void pickRef(e.target.value)} style={css(IN)} />
            {/* TODO(backend): ใบลดหนี้ไม่อ้างอิง (CN[no-ref] · เครดิตคงค้าง) — saveSalesDraft ยังบังคับ refDocumentId */}
            <span style={css(F.hint)}>ไม่มีเอกสารอ้างอิง → <a href="/sales/credit-notes/new?noref=1">ออก CN ลอย</a> (ใช้สูตร CN[no-ref] เก็บเป็นเครดิตคงค้าง)</span></label>
          <label style={css(F.label)}>วันที่<input readOnly={!editable} value={date} onChange={(e) => setDate(e.target.value)} style={css(`${IN}; font-variant-numeric: tabular-nums`)} /></label>
          {/* TODO(backend): "เก็บเป็นเครดิตคงค้าง ตัดภายหลัง" — approveDocument ตัด CN กับใบอ้างอิงทันทีเสมอ */}
          <label style={css(F.label)}>การตัดกับ IV<select disabled={!editable} value={apply} onChange={(e) => setApply(e.target.value as 'now' | 'later')} style={css(IN)}><option value="now">ตัดกับ {ref ? docNo(ref.doc) : 'IV'} ทันที</option><option value="later">เก็บเป็นเครดิตคงค้าง ตัดภายหลัง</option></select></label>
          {/* TODO(backend): เหตุที่ลด/เพิ่มหนี้ยังไม่มีฟิลด์ของตัวเอง → เก็บใน reference · คำอธิบายเพิ่มเติมเก็บใน notes */}
          {kind === 'CN'
            ? <label style={css(F.label2)}>เหตุที่ลดหนี้ (ม.82/10 · พิมพ์บนเอกสารตาม ม.86/10)<select disabled={!editable} value={reason} onChange={(e) => setReason(e.target.value)} style={css(IN)}>{(REASONS as readonly string[]).includes(reason) ? null : <option value={reason}>{reason || '—'}</option>}{REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>
            // TODO(Wei): ไม่มีแบบร่างใบเพิ่มหนี้ (DN) — เหตุที่เพิ่มหนี้ (ม.86/9) กรอกเอง
            : <label style={css(F.label2)}>เหตุที่เพิ่มหนี้ (ม.86/9)<input readOnly={!editable} value={reason} onChange={(e) => setReason(e.target.value)} style={css(IN)} /></label>}
          <label style={css(F.label2)}>คำอธิบายเพิ่มเติม<input readOnly={!editable} value={desc} onChange={(e) => setDesc(e.target.value)} style={css(IN)} /></label>
        </section>

        <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          {!useFree ? (
            <table style={css('width: 100%; min-width: 760px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
              <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>รายการจากใบกำกับเดิม</th><th style={css(F.thNum)}>จำนวนเดิม</th><th style={css(F.thNum)}>ลดจำนวน</th><th style={css(F.thNum)}>ราคา/หน่วย</th><th style={css(F.th)}>คืนสต๊อก</th><th style={css(F.thNum)}>มูลค่าที่ลด</th></tr></thead>
              <tbody>{refRows.map((r, i) => {
                const n = parseDec(r.reduce, 4) ?? 0n;
                const value = n > 0n ? qtyTimesPrice(r.reduce, r.line.unit_price ?? '0') : '';
                return (
                  <tr key={r.line.id} style={css('border-top: 1px solid #e0e0e0')}>
                    <td style={css('height: 40px; padding: 0 12px')}>{r.line.product_code ? `${r.line.product_code} ` : ''}{r.line.description}</td>
                    <td style={css(F.num)}>{r.line.qty === null ? '—' : qtyText(r.line.qty)}</td>
                    <td style={css('padding: 0 12px; text-align: right')}>{editable
                      ? <input aria-label={`ลดจำนวน ${r.line.product_code ?? r.line.description}`} value={r.reduce} onChange={(e) => setRefRows(refRows.map((x, j) => (j === i ? { ...x, reduce: e.target.value } : x)))} style={css('width: 64px; height: 32px; text-align: right; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-variant-numeric: tabular-nums')} />
                      : qtyText(r.reduce)}</td>
                    <td style={css(F.num)}>{priceText(r.line.unit_price)}</td>
                    {/* v1 ไม่มีสต็อก (CLAUDE.md) */}
                    <td style={css('padding: 0 12px; color: #525252')}>{n > 0n ? 'โมดูลสต๊อกปิด' : '—'}</td>
                    <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{money(value)}</td>
                  </tr>
                );
              })}
              {!refRows.length && <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={6} style={css('height: 40px; padding: 0 12px; color: #525252')}>—</td></tr>}
              </tbody>
            </table>
          ) : (
            // TODO(Wei): ไม่มีแบบร่างตารางของใบเพิ่มหนี้/ใบลดหนี้ไม่อ้างอิง — ใช้บรรทัดอิสระ
            <table style={css('width: 100%; min-width: 760px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
              <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>รายการ</th><th style={css(F.thNum)}>จำนวน</th><th style={css(F.thNum)}>ราคา/หน่วย</th><th style={css(F.thNum)}>{kind === 'DN' ? 'มูลค่าที่เพิ่ม' : 'มูลค่าที่ลด'}</th></tr></thead>
              <tbody>
                {free.map((r, i) => (
                  <tr key={i} style={css('border-top: 1px solid #e0e0e0')}>
                    <td style={css('height: 40px; padding: 0 12px')}>{editable ? <input aria-label={`รายการ บรรทัด ${i + 1}`} value={r.item} onChange={(e) => setFreeRow(i, 'item', e.target.value)} style={css(F.cell)} /> : r.item}</td>
                    <td style={css(F.num)}>{editable ? <input aria-label={`จำนวน บรรทัด ${i + 1}`} value={r.qty} onChange={(e) => setFreeRow(i, 'qty', e.target.value)} style={css(`${F.cellNum}; width: 72px`)} /> : r.qty}</td>
                    <td style={css(F.num)}>{editable ? <input aria-label={`ราคา/หน่วย บรรทัด ${i + 1}`} value={r.price} onChange={(e) => setFreeRow(i, 'price', e.target.value)} style={css(`${F.cellNum}; width: 110px`)} /> : r.price}</td>
                    <td style={css(F.num)}>{money(validRow(r) ? qtyTimesPrice(r.qty, r.price) : '')}</td>
                  </tr>
                ))}
                {editable && <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={4} style={css('height: 40px; padding: 0 12px')}><Button kind="ghost" size={32} onClick={() => setFree([...free, blankLine()])}>+ เพิ่มบรรทัด (Enter)</Button></td></tr>}
              </tbody>
            </table>
          )}
        </section>

        <div style={css('display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start; justify-content: space-between')}>
          <div style={css('font-size: 14px; color: #525252; line-height: 1.8')}>มูลค่าตามใบกำกับเดิม {money(original)}<br />มูลค่าที่ถูกต้อง {money(corrected)}<br /><strong style={css('color: #161616')}>ผลต่าง {money(net)}</strong> — พิมพ์ครบ 3 บรรทัดบนเอกสารตามประกาศอธิบดี</div>
          <table style={css('flex: 0 1 340px; border-collapse: collapse; font-size: 15px')}><tbody>
            <tr><td style={css('height: 32px')}>{kind === 'DN' ? 'มูลค่าที่เพิ่ม' : 'มูลค่าที่ลด'}</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{money(net)}</td></tr>
            <tr><td style={css('height: 32px')}>ภาษีมูลค่าเพิ่ม 7%</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{money(totals?.vat ?? '0.00')}</td></tr>
            <tr style={css('border-top: 1px solid #8d8d8d')}><td style={css('height: 40px; font-weight: 600; font-size: 16px')}>{kind === 'DN' ? 'ยอดเพิ่มหนี้รวม' : 'ยอดลดหนี้รวม'}</td><td style={css('text-align: right; font-weight: 600; font-size: 16px; font-variant-numeric: tabular-nums')}>{money(totals?.grandTotal ?? '0.00')}</td></tr>
            {ref && after !== null && <tr><td style={css('height: 28px; font-size: 13px; color: #525252')}>{docNo(ref.doc)} ค้างชำระหลังตัด</td><td style={css('text-align: right; font-size: 13px; color: #525252; font-variant-numeric: tabular-nums')}>{money(after)}</td></tr>}
          </tbody></table>
        </div>
        {err && <Msg msg={{ kind: 'err', text: err }} />}

        <JournalPreview title="ตัวอย่างการลงบัญชี" note={`สูตร ${rule}`} amountWidth="110px"
          source={{ rule, docType: kind, totals, lineAccounts: rows.filter(validRow).map((r) => r.account.trim().slice(0, 7) || null) }}
          posted={detail?.journal.length ? detail.journal : null} names={names} />
        <Msg msg={msg} />
      </div>
      <div style={css(F.sticky)}>
        {/* TODO(M7): "ส่งสำเนาให้ลูกค้าอัตโนมัติ" — ยังไม่มีระบบส่งอีเมล */}
        <span style={css('font-size: 13px; color: #525252')}>ลงรายงานภาษีขาย {iso ? `${iso.slice(5, 7)}/${Number(iso.slice(0, 4)) + 543}` : '—'}{kind === 'CN' ? ' เป็นยอดติดลบ' : ''} · ส่งสำเนาให้ลูกค้าอัตโนมัติ</span>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          {d?.status === 'posted' && <ButtonLink kind="danger" href={`/finance/docs/${d.id}/void`}>ยกเลิกเอกสาร</ButtonLink>}
          {id ? <ButtonLink href={`/print/credit-note/${id}`}>พิมพ์ใบลดหนี้</ButtonLink> : <Button disabled>พิมพ์ใบลดหนี้</Button>}
          {id ? <ButtonLink href={`/print/debit-note/${id}`}>ตัวอย่างใบเพิ่มหนี้</ButtonLink> : <Button disabled>ตัวอย่างใบเพิ่มหนี้</Button>}
          {editable && <Button onClick={() => void save()}>บันทึกร่าง</Button>}
          {editable && <Button kind="primary" onClick={() => void approve()}>อนุมัติและลงบัญชี</Button>}
        </div>
      </div>
    </>
  );
}
