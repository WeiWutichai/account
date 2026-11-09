// F3 ทะเบียนเช็ค — design/project/ScreenCheque.dc.html · ข้อมูลจาก GET /v1/cheques?direction=received|issued
import { api } from '../../lib/api';
import { Shell } from '../../lib/shell';
import { today } from '../_shared/types';
import { ChequeScreen, type ChequeRegister } from './_screen';

export default async function ChequePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const direction = sp.direction === 'issued' ? 'issued' : 'received';
  const reg = await api<ChequeRegister>(`/v1/cheques?direction=${direction}`);
  return (
    <Shell active="cheque">
      <ChequeScreen key={direction} direction={direction} today={today()} register={reg} />
    </Shell>
  );
}
