// เส้นทางของแอป ↔ ไฟล์แบบร่าง ↔ milestone (docs/page-map.md) · ใช้ทั้ง Sidebar และหน้า "ยังไม่เปิดใช้"
export interface RouteDef { id: string; path: string; design: string; milestone: string }

export const ROUTES: readonly RouteDef[] = [
  { id: 'home', path: '/', design: 'Main', milestone: 'M4' },
  { id: 'quote', path: '/sales/quotes', design: 'ScreenQuote', milestone: 'M4' },
  { id: 'invoice', path: '/sales/invoices', design: 'ScreenDocList', milestone: 'M4' },
  { id: 'creditnote', path: '/sales/credit-notes', design: 'ScreenCreditNote', milestone: 'M4' },
  { id: 'deposit', path: '/sales/deposits', design: 'ScreenDeposit', milestone: 'M4' },
  { id: 'po', path: '/purchase/orders', design: 'ScreenPurchaseOrder', milestone: 'M5' },
  { id: 'purchase', path: '/purchase/bills', design: 'ScreenPurchaseList', milestone: 'M5' },
  { id: 'purchasecn', path: '/purchase/credit-notes', design: 'ScreenPurchaseCreditNote', milestone: 'M5' },
  { id: 'expense', path: '/purchase/expenses', design: 'ScreenExpense', milestone: 'M5' },
  { id: 'bn', path: '/finance/billing', design: 'ScreenBilling', milestone: 'M4' },
  { id: 'receipt', path: '/finance/receipts', design: 'ScreenReceipt', milestone: 'M4' },
  { id: 'payment', path: '/finance/payments', design: 'ScreenPayment', milestone: 'M5' },
  { id: 'cheque', path: '/finance/cheques', design: 'ScreenCheque', milestone: 'M4' },
  { id: 'pettycash', path: '/finance/petty-cash', design: 'ScreenPettyCash', milestone: 'M5' },
  { id: 'bank', path: '/finance/bank-recon', design: 'ScreenBankRecon', milestone: 'M6' },
  { id: 'journal', path: '/gl/journal', design: 'ScreenJournal', milestone: 'M2' },
  { id: 'ledger', path: '/gl/ledger', design: 'ScreenLedger', milestone: 'M2' },
  { id: 'coa', path: '/gl/accounts', design: 'ScreenCOA', milestone: 'M2' },
  { id: 'formula', path: '/gl/rules', design: 'ScreenFormula', milestone: 'M2' },
  { id: 'assets', path: '/gl/assets', design: 'ScreenAssets', milestone: 'M6' },
  { id: 'tax', path: '/tax', design: 'ScreenTax', milestone: 'M6' },
  { id: 'recon', path: '/tax/recon', design: 'ScreenReconReport', milestone: 'M6' },
  { id: 'close', path: '/gl/period-close', design: 'ScreenPeriodClose', milestone: 'M6' },
  { id: 'reports', path: '/reports', design: 'ScreenReports', milestone: 'M6' },
  { id: 'aging', path: '/reports/aging', design: 'ScreenAging', milestone: 'M6' },
  { id: 'contacts', path: '/master/contacts', design: 'ScreenContacts', milestone: 'M2' },
  { id: 'products', path: '/master/products', design: 'ScreenProducts', milestone: 'M2' },
  { id: 'settings', path: '/settings/company', design: 'ScreenSettings', milestone: 'M1–M2' },
  { id: 'docsettings', path: '/settings/documents', design: 'ScreenDocSettings', milestone: 'M4' },
  { id: 'users', path: '/settings/users', design: 'ScreenUsers', milestone: 'M3' },
  { id: 'apps', path: '/settings/apps', design: 'ScreenApps', milestone: 'M7' },
  { id: 'mcp', path: '/settings/mcp', design: 'ScreenMcp', milestone: 'M7' },
  { id: 'audit', path: '/settings/audit', design: 'ScreenAudit', milestone: 'M7' },
  { id: 'opening', path: '/setup/opening-balance', design: 'ScreenOpeningBalance', milestone: 'M2' },
  { id: 'companyCreate', path: '/companies/new', design: 'ScreenCompanyCreate', milestone: 'M3' },
  { id: 'companies', path: '/companies', design: 'ScreenCompanyPicker', milestone: 'M3' },
  { id: 'profile', path: '/me', design: 'ScreenProfile', milestone: 'M3' },
  { id: 'login', path: '/login', design: 'ScreenLogin', milestone: 'M3' },
];

export const route = (id: string): RouteDef => {
  const r = ROUTES.find((x) => x.id === id);
  if (!r) throw new Error(`ไม่มี route ${id}`);
  return r;
};
export const href = (id: string): string => route(id).path;
