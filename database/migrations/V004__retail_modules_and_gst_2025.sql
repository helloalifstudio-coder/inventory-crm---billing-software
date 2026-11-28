-- ============================================================================
-- MIGRATION V004: 2025/2026 APPAREL GST (5%/18% + IGST) & RETAIL OPERATIONS PACK
--   Adds: Sales Returns & Store Credit Notes, Supplier Purchases (GRN),
--   Cashier Shifts & Z-Report, Tailoring/Alteration Slips & Security Audit Log.
-- ============================================================================

-- 1. Extend bills & bill_items for Inter-State IGST, Returns & Credit Note Redemption
ALTER TABLE bills ADD COLUMN IF NOT EXISTS is_igst BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS shift_id BIGINT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS credit_note_used VARCHAR(40) DEFAULT '';
ALTER TABLE bills ADD COLUMN IF NOT EXISTS credit_note_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'COMPLETED';

ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS igst_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00;

-- 2. Suppliers / Wholesalers Master & Purchase Bills (GRN Stock-In)
CREATE TABLE IF NOT EXISTS suppliers (
    id BIGSERIAL PRIMARY KEY,
    supplier_code VARCHAR(40) UNIQUE NOT NULL,
    name VARCHAR(180) NOT NULL,
    phone VARCHAR(30) DEFAULT '',
    gstin VARCHAR(30) DEFAULT '',
    city VARCHAR(100) DEFAULT '',
    address TEXT DEFAULT '',
    opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    total_purchased NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    total_paid NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_bills (
    id BIGSERIAL PRIMARY KEY,
    purchase_no VARCHAR(50) UNIQUE NOT NULL,
    supplier_id BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
    supplier_name VARCHAR(180) NOT NULL DEFAULT '',
    invoice_no VARCHAR(60) DEFAULT '',
    total_qty INTEGER NOT NULL DEFAULT 0,
    taxable_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    gst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    payment_status VARCHAR(24) NOT NULL DEFAULT 'PAID',
    items_json TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Sales Returns, Exchanges & Store Credit Notes
CREATE TABLE IF NOT EXISTS returns (
    id BIGSERIAL PRIMARY KEY,
    return_no VARCHAR(40) UNIQUE NOT NULL,
    original_bill_id BIGINT REFERENCES bills(id) ON DELETE SET NULL,
    original_bill_no VARCHAR(40) NOT NULL,
    customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
    customer_name VARCHAR(180) DEFAULT '',
    customer_phone VARCHAR(30) DEFAULT '',
    total_qty INTEGER NOT NULL DEFAULT 0,
    refund_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    refund_mode VARCHAR(30) NOT NULL DEFAULT 'CREDIT_NOTE',
    credit_note_no VARCHAR(40) DEFAULT '',
    reason TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS return_items (
    id BIGSERIAL PRIMARY KEY,
    return_id BIGINT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    garment_id BIGINT REFERENCES garments(id) ON DELETE SET NULL,
    sku VARCHAR(80) NOT NULL,
    garment_name VARCHAR(220) NOT NULL DEFAULT '',
    qty INTEGER NOT NULL DEFAULT 1,
    unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    refund_line_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    restocked BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credit_notes (
    id BIGSERIAL PRIMARY KEY,
    credit_note_no VARCHAR(40) UNIQUE NOT NULL,
    return_id BIGINT REFERENCES returns(id) ON DELETE SET NULL,
    customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
    customer_phone VARCHAR(30) DEFAULT '',
    customer_name VARCHAR(180) DEFAULT '',
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    balance_remaining NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    redeemed_bill_no VARCHAR(40) DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Cashier Shifts & Day-End Cash Drawer Z-Report
CREATE TABLE IF NOT EXISTS cash_shifts (
    id BIGSERIAL PRIMARY KEY,
    shift_no VARCHAR(40) UNIQUE NOT NULL,
    cashier_name VARCHAR(120) NOT NULL DEFAULT 'Counter Staff',
    opening_cash NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    cash_sales NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    upi_sales NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    card_sales NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    cash_refunds NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    cash_payouts NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    expected_cash NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    counted_cash NUMERIC(12, 2),
    variance_amount NUMERIC(12, 2) DEFAULT 0.00,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    notes TEXT DEFAULT '',
    opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP
);

-- 5. Apparel Tailoring / Alteration Fitting Slips
CREATE TABLE IF NOT EXISTS alterations (
    id BIGSERIAL PRIMARY KEY,
    slip_no VARCHAR(40) UNIQUE NOT NULL,
    bill_no VARCHAR(40) DEFAULT '',
    customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
    customer_name VARCHAR(180) NOT NULL,
    customer_phone VARCHAR(30) DEFAULT '',
    garment_name VARCHAR(220) NOT NULL DEFAULT '',
    measurements TEXT DEFAULT '',
    tailor_notes TEXT DEFAULT '',
    delivery_date VARCHAR(30) DEFAULT '',
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Staff Actions & Compliance Audit Log
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_role VARCHAR(30) NOT NULL DEFAULT 'owner',
    action_type VARCHAR(60) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_ref VARCHAR(80) DEFAULT '',
    summary TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_returns_orig_bill ON returns (original_bill_no);
CREATE INDEX IF NOT EXISTS idx_credit_notes_phone ON credit_notes (customer_phone, status);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchase_bills (supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON cash_shifts (status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_alterations_status ON alterations (status, delivery_date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);
