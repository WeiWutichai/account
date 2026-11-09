// D3 แบบพิมพ์ใบลดหนี้ — design/project/PrintCreditNote.dc.html · PDF: ./pdf
import { AdjustNote } from '../../_lib/adjust';

export const metadata = { title: 'แบบพิมพ์ ใบลดหนี้' };

export default async function PrintCreditNote({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <AdjustNote kind="CN" id={id} sp={sp} />;
}
