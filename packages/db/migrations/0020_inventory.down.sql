-- ย้อน 0020 สินค้าคงคลัง (ข้อมูลสต็อกทั้งหมดหายไป — เอกสาร GR/GI/TRF/ADJ ยังอยู่ใน acct.document)
DROP TABLE acct.inventory_journal;
DROP TABLE acct.stock_balance;
DROP TABLE acct.stock_move;
ALTER TABLE acct.document_line DROP COLUMN grir_amount, DROP COLUMN counted_qty, DROP COLUMN unit;
ALTER TABLE acct.document DROP CONSTRAINT document_to_warehouse, DROP CONSTRAINT document_warehouse, DROP COLUMN to_warehouse_id, DROP COLUMN warehouse_id;
DROP TABLE acct.product_unit;
DROP INDEX acct.product_barcode;
ALTER TABLE acct.product DROP CONSTRAINT product_cogs_account, DROP CONSTRAINT product_inventory_account,
  DROP COLUMN barcode, DROP COLUMN max_qty, DROP COLUMN reorder_point, DROP COLUMN cogs_account, DROP COLUMN inventory_account, DROP COLUMN track_stock;
DROP TABLE acct.warehouse;
