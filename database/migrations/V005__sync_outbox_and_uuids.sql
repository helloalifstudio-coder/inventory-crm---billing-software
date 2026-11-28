-- ============================================================================
-- MIGRATION V005: CONFLICT-FREE UUID IDENTITY & BI-DIRECTIONAL SYNC CURSORS
-- ============================================================================

ALTER TABLE garments ADD COLUMN IF NOT EXISTS record_uuid VARCHAR(64) DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS record_uuid VARCHAR(64) DEFAULT '';
ALTER TABLE bills ADD COLUMN IF NOT EXISTS record_uuid VARCHAR(64) DEFAULT '';
ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS record_uuid VARCHAR(64) DEFAULT '';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS record_uuid VARCHAR(64) DEFAULT '';
ALTER TABLE purchase_bills ADD COLUMN IF NOT EXISTS record_uuid VARCHAR(64) DEFAULT '';
ALTER TABLE returns ADD COLUMN IF NOT EXISTS record_uuid VARCHAR(64) DEFAULT '';
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS record_uuid VARCHAR(64) DEFAULT '';
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS record_uuid VARCHAR(64) DEFAULT '';
ALTER TABLE alterations ADD COLUMN IF NOT EXISTS record_uuid VARCHAR(64) DEFAULT '';

CREATE TABLE IF NOT EXISTS sync_cursors (
    device_id VARCHAR(80) PRIMARY KEY,
    last_pulled_at TIMESTAMP NOT NULL DEFAULT '1970-01-01 00:00:00',
    last_pushed_at TIMESTAMP NOT NULL DEFAULT '1970-01-01 00:00:00',
    device_name VARCHAR(160) DEFAULT '',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_garments_uuid ON garments (record_uuid) WHERE record_uuid <> '';
CREATE INDEX IF NOT EXISTS idx_customers_uuid ON customers (record_uuid) WHERE record_uuid <> '';
CREATE INDEX IF NOT EXISTS idx_bills_uuid ON bills (record_uuid) WHERE record_uuid <> '';
CREATE INDEX IF NOT EXISTS idx_bill_items_uuid ON bill_items (record_uuid) WHERE record_uuid <> '';
CREATE INDEX IF NOT EXISTS idx_bills_updated_sync ON bills (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_garments_updated_sync ON garments (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_updated_sync ON customers (updated_at DESC);
