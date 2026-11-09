// D5 แบบพิมพ์ใบเพิ่มหนี้ — design/project/PrintDebitNote.dc.html · PDF: ./pdf
import { AdjustNote } from '../../_lib/adjust';

export const metadata = { title: 'แบบพิมพ์ ใบเพิ่มหนี้' };

export default async function PrintDebitNote({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <AdjustNote kind="DN" id={id} sp={sp} />;
}
