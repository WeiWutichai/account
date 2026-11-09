// M0 placeholder — หน้าจริงทำตาม design/project/*.dc.html ตาม milestone ใน docs/page-map.md
import { SERVICE } from './service';

export default function Page() {
  return (
    <main style={{ padding: 32 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>AccountSystem</h1>
      <p style={{ color: '#525252' }}>M0 placeholder · {SERVICE}</p>
    </main>
  );
}
