// ข้อมูลหลัก / สินค้าและบริการ — design/project/ScreenProducts.dc.html · ข้อมูลจาก GET /v1/master/products (+ /:code)
import { api } from '../../lib/api';
import { currentPeriod, Shell } from '../../lib/shell';
import type { Account } from '../../finance/_shared/types';
import { ProductsScreen, type ProductDetail, type ProductsOverview } from './_screen';

const KINDS = ['service', 'goods', 'expense', 'kit'];
interface WhtType { key: string; rate: string; label: string }

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ code?: string; kind?: string }> }) {
  const sp = await searchParams;
  const kind = KINDS.includes(sp.kind ?? '') ? sp.kind! : '';
  const { year } = await currentPeriod();
  const [overview, accounts, types] = await Promise.all([
    api<ProductsOverview>(`/v1/master/products${kind ? `?kind=${kind}` : ''}`),
    api<Account[]>(`/v1/accounts?year=${year}&period=13`),
    api<Record<string, WhtType>>('/v1/wht-types'),
  ]);
  // ไม่ได้เลือก = แถวแรก (แบบร่างไฮไลต์แถวแรก)
  const code = sp.code ?? overview.rows[0]?.code;
  const detail = code ? await api<ProductDetail>(`/v1/master/products/${encodeURIComponent(code)}`) : null;
  return (
    <Shell active="products">
      <ProductsScreen overview={overview} detail={detail} kind={kind}
        accounts={accounts.map((a) => ({ code: a.code, name: a.name }))}
        whtTypes={Object.values(types).map((t) => ({ key: t.key, rate: t.rate, label: t.label }))} />
    </Shell>
  );
}
