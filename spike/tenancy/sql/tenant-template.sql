-- ตาราง tenant จำลอง (ใกล้ของจริง ไม่ครบ) · รันหลัง SET search_path TO <schema>
-- {{CID}} = คอลัมน์ company_id (ทางเลือก ค) หรือว่าง (ก/ข)
CREATE TABLE account (
  {{CID}} code text NOT NULL, name text NOT NULL, type text NOT NULL,
  PRIMARY KEY ({{CIDK}} code)
);
CREATE TABLE contact (
  {{CID}} id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, code text NOT NULL, name text NOT NULL, tax_id text
);
CREATE TABLE document (
  {{CID}} id bigserial PRIMARY KEY, doc_no text NOT NULL, doc_type text NOT NULL, doc_date date NOT NULL,
  contact_id uuid REFERENCES contact(id), status text NOT NULL,
  subtotal numeric(18,2) NOT NULL, vat numeric(18,2) NOT NULL, grand_total numeric(18,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE document_line (
  {{CID}} id bigserial PRIMARY KEY, document_id bigint NOT NULL REFERENCES document(id), line_no int NOT NULL,
  description text NOT NULL, qty numeric(18,4) NOT NULL, unit_price numeric(18,4) NOT NULL, amount numeric(18,2) NOT NULL
);
CREATE TABLE journal (
  {{CID}} id bigserial PRIMARY KEY, journal_no text NOT NULL, journal_date date NOT NULL,
  document_id bigint REFERENCES document(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE journal_line (
  {{CID}} id bigserial PRIMARY KEY, journal_id bigint NOT NULL REFERENCES journal(id), line_no int NOT NULL,
  account_code text NOT NULL, debit numeric(18,2) NOT NULL DEFAULT 0, credit numeric(18,2) NOT NULL DEFAULT 0
);
CREATE INDEX document_status_date ON document ({{CIDK}} status, doc_date DESC);
CREATE INDEX journal_line_account ON journal_line ({{CIDK}} account_code);
CREATE INDEX journal_line_journal ON journal_line (journal_id);
CREATE INDEX document_line_document ON document_line (document_id);
