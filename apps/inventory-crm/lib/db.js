const { Pool } = require("pg");

let attachDatabasePool = null;
try {
    ({ attachDatabasePool } = require("@vercel/functions"));
} catch (_) {}

let primaryPool = null;
let secondaryPool = null;
const schemaInitialized = new WeakSet();

const PRIMARY_MAX_MB = Number(process.env.PRIMARY_MAX_MB || 420);

function makePool(connStr) {
    if (!connStr) return null;
    const isLocal = connStr.includes("127.0.0.1") || connStr.includes("localhost");
    let cleanConnStr = connStr;
    if (!isLocal) {
        try {
            const u = new URL(connStr);
            // Prevent pg-connection-string from treating ?sslmode=require as strict verify-full
            // against managed poolers (Supabase Transaction Pooler uses an intermediate CA).
            u.searchParams.delete("sslmode");
            u.searchParams.delete("uselibpqcompat");
            cleanConnStr = u.toString();
        } catch (_) {}
    }
    const pool = new Pool({
        connectionString: cleanConnStr,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 20000,
        connectionTimeoutMillis: 15000,
    });
    if (attachDatabasePool && (process.env.VERCEL === "1" || process.env.NODE_ENV === "production")) {
        try {
            attachDatabasePool(pool);
        } catch (_) {}
    }
    return pool;
}

function getPrimaryPool() {
    const url = process.env.PRIMARY_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
    if (!url) return null;
    if (!primaryPool) primaryPool = makePool(url);
    return primaryPool;
}

function getSecondaryPool() {
    const url = process.env.SECONDARY_DATABASE_URL || "";
    if (!url) return null;
    if (!secondaryPool) secondaryPool = makePool(url);
    return secondaryPool;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(120) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE IF NOT EXISTS bill_no_seq START 1;

CREATE TABLE IF NOT EXISTS store_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    store_name VARCHAR(200) NOT NULL DEFAULT 'Showroom POS & Inventory',
    address_line1 VARCHAR(250) NOT NULL DEFAULT '',
    address_line2 VARCHAR(250) NOT NULL DEFAULT '',
    phone VARCHAR(50) NOT NULL DEFAULT '',
    gstin VARCHAR(30) NOT NULL DEFAULT '',
    bill_prefix VARCHAR(20) NOT NULL DEFAULT 'INV-',
    thermal_width VARCHAR(10) NOT NULL DEFAULT '80mm',
    tax_mode VARCHAR(20) NOT NULL DEFAULT 'exclusive',
    footer_note TEXT NOT NULL DEFAULT 'Thank you for shopping with us.',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO store_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS automation_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    printer_mode VARCHAR(30) NOT NULL DEFAULT 'browser',
    whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    whatsapp_mode VARCHAR(30) NOT NULL DEFAULT 'wa_link',
    whatsapp_api_url TEXT NOT NULL DEFAULT '',
    whatsapp_api_token TEXT NOT NULL DEFAULT '',
    whatsapp_phone_number_id VARCHAR(100) NOT NULL DEFAULT '',
    whatsapp_template TEXT NOT NULL DEFAULT 'Hello {customer_name}, thank you for shopping at {store_name}! Your Bill {bill_no} for Rs.{grand_total} ({items_summary}) is confirmed. Visit us again!',
    sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    sms_provider VARCHAR(30) NOT NULL DEFAULT 'fast2sms',
    sms_api_key TEXT NOT NULL DEFAULT '',
    sms_sender_id VARCHAR(30) NOT NULL DEFAULT '',
    sms_template TEXT NOT NULL DEFAULT 'Thank you {customer_name} for shopping at {store_name}. Bill {bill_no}, Total Rs.{grand_total}. Have a great day!',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO automation_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS customers (
    id BIGSERIAL PRIMARY KEY,
    customer_code VARCHAR(32) UNIQUE NOT NULL,
    full_name VARCHAR(180) NOT NULL,
    phone VARCHAR(30) UNIQUE NOT NULL,
    email VARCHAR(180) DEFAULT '',
    city VARCHAR(120) DEFAULT '',
    address TEXT DEFAULT '',
    gstin VARCHAR(30) DEFAULT '',
    notes TEXT DEFAULT '',
    total_visits INTEGER NOT NULL DEFAULT 0,
    total_items_bought INTEGER NOT NULL DEFAULT 0,
    total_spent NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    last_purchase_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS garments (
    id BIGSERIAL PRIMARY KEY,
    sku VARCHAR(80) UNIQUE NOT NULL,
    barcode VARCHAR(80) UNIQUE NOT NULL,
    name VARCHAR(220) NOT NULL,
    category VARCHAR(100) NOT NULL,
    sub_category VARCHAR(100) NOT NULL DEFAULT 'Men''s Wear',
    size VARCHAR(30) NOT NULL DEFAULT '40',
    colour VARCHAR(60) NOT NULL DEFAULT 'Ivory',
    fabric_type VARCHAR(100) DEFAULT '',
    rack_location VARCHAR(50) DEFAULT 'RACK-A1',
    hsn_code VARCHAR(20) NOT NULL DEFAULT '6203',
    cost_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    mrp_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    selling_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    stock_qty INTEGER NOT NULL DEFAULT 0,
    min_stock_alert INTEGER NOT NULL DEFAULT 3,
    total_sold INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bills (
    id BIGSERIAL PRIMARY KEY,
    bill_no VARCHAR(40) UNIQUE NOT NULL,
    customer_id BIGINT NULL REFERENCES customers(id) ON DELETE SET NULL,
    customer_code VARCHAR(32) DEFAULT '',
    customer_name VARCHAR(180) NOT NULL DEFAULT 'Walk-in Customer',
    customer_phone VARCHAR(30) DEFAULT '',
    customer_city VARCHAR(120) DEFAULT '',
    payment_mode VARCHAR(40) NOT NULL DEFAULT 'Cash',
    tax_mode VARCHAR(20) NOT NULL DEFAULT 'exclusive',
    total_qty INTEGER NOT NULL DEFAULT 0,
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    taxable_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    cgst_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    sgst_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_gst NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    grand_total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    amount_received NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    change_returned NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    cash_paid NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    upi_paid NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    card_paid NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    notes TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bill_items (
    id BIGSERIAL PRIMARY KEY,
    bill_id BIGINT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    customer_id BIGINT NULL REFERENCES customers(id) ON DELETE SET NULL,
    garment_id BIGINT NULL REFERENCES garments(id) ON DELETE SET NULL,
    sku VARCHAR(80) NOT NULL,
    barcode VARCHAR(80) DEFAULT '',
    garment_name VARCHAR(220) NOT NULL,
    category VARCHAR(100) DEFAULT '',
    size VARCHAR(30) DEFAULT '',
    colour VARCHAR(60) DEFAULT '',
    hsn_code VARCHAR(20) DEFAULT '6203',
    qty INTEGER NOT NULL DEFAULT 1,
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    line_discount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    taxable_value NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    gst_rate NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    cgst_rate NUMERIC(5,2) NOT NULL DEFAULT 2.50,
    cgst_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    sgst_rate NUMERIC(5,2) NOT NULL DEFAULT 2.50,
    sgst_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    line_total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_ledger (
    id BIGSERIAL PRIMARY KEY,
    garment_id BIGINT NOT NULL REFERENCES garments(id) ON DELETE CASCADE,
    sku VARCHAR(80) NOT NULL,
    change_qty INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    movement_type VARCHAR(40) NOT NULL,
    reference_no VARCHAR(80) DEFAULT '',
    remarks TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_logs (
    id BIGSERIAL PRIMARY KEY,
    bill_id BIGINT NULL REFERENCES bills(id) ON DELETE SET NULL,
    bill_no VARCHAR(40) DEFAULT '',
    customer_name VARCHAR(180) DEFAULT '',
    customer_phone VARCHAR(30) DEFAULT '',
    channel VARCHAR(20) NOT NULL,
    status VARCHAR(30) NOT NULL,
    message_text TEXT NOT NULL,
    provider_response TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);
CREATE INDEX IF NOT EXISTS idx_customers_spent ON customers (total_spent DESC);
CREATE INDEX IF NOT EXISTS idx_customers_last_purchase ON customers (last_purchase_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_bills_customer_date ON bills (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bills_created ON bills (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_items_customer ON bill_items (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_items_bill ON bill_items (bill_id);
CREATE INDEX IF NOT EXISTS idx_garments_active_cat ON garments (active, category);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_created ON stock_ledger (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_logs_created ON notification_logs (created_at DESC);

ALTER TABLE bills ADD COLUMN IF NOT EXISTS customer_city VARCHAR(120) DEFAULT '';
ALTER TABLE bills ADD COLUMN IF NOT EXISTS customer_gstin VARCHAR(30) DEFAULT '';
ALTER TABLE bills ADD COLUMN IF NOT EXISTS is_igst BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS shift_id BIGINT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS credit_note_used VARCHAR(40) DEFAULT '';
ALTER TABLE bills ADD COLUMN IF NOT EXISTS credit_note_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE bills ADD COLUMN IF NOT EXISTS record_uuid VARCHAR(64) DEFAULT '';
ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS igst_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00;
ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS record_uuid VARCHAR(64) DEFAULT '';
ALTER TABLE garments ADD COLUMN IF NOT EXISTS record_uuid VARCHAR(64) DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS record_uuid VARCHAR(64) DEFAULT '';
ALTER TABLE automation_settings ADD COLUMN IF NOT EXISTS printer_mode VARCHAR(30) NOT NULL DEFAULT 'browser';
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS customer_name VARCHAR(180) NOT NULL DEFAULT '';
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS message_text TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS suppliers (
    id BIGSERIAL PRIMARY KEY,
    record_uuid VARCHAR(64) DEFAULT '',
    supplier_code VARCHAR(40) UNIQUE NOT NULL,
    name VARCHAR(180) NOT NULL,
    phone VARCHAR(30) DEFAULT '',
    gstin VARCHAR(30) DEFAULT '',
    city VARCHAR(100) DEFAULT '',
    address TEXT DEFAULT '',
    opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    total_purchased NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    total_paid NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_bills (
    id BIGSERIAL PRIMARY KEY,
    record_uuid VARCHAR(64) DEFAULT '',
    purchase_no VARCHAR(50) UNIQUE NOT NULL,
    supplier_id BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
    supplier_name VARCHAR(180) NOT NULL DEFAULT '',
    invoice_no VARCHAR(60) DEFAULT '',
    total_qty INTEGER NOT NULL DEFAULT 0,
    taxable_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    gst_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    grand_total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    payment_status VARCHAR(24) NOT NULL DEFAULT 'PAID',
    items_json TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS returns (
    id BIGSERIAL PRIMARY KEY,
    record_uuid VARCHAR(64) DEFAULT '',
    return_no VARCHAR(40) UNIQUE NOT NULL,
    original_bill_id BIGINT REFERENCES bills(id) ON DELETE SET NULL,
    original_bill_no VARCHAR(40) NOT NULL,
    customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
    customer_name VARCHAR(180) DEFAULT '',
    customer_phone VARCHAR(30) DEFAULT '',
    total_qty INTEGER NOT NULL DEFAULT 0,
    refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
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
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    refund_line_total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    restocked BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credit_notes (
    id BIGSERIAL PRIMARY KEY,
    record_uuid VARCHAR(64) DEFAULT '',
    credit_note_no VARCHAR(40) UNIQUE NOT NULL,
    return_id BIGINT REFERENCES returns(id) ON DELETE SET NULL,
    customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
    customer_phone VARCHAR(30) DEFAULT '',
    customer_name VARCHAR(180) DEFAULT '',
    amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    balance_remaining NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    redeemed_bill_no VARCHAR(40) DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cash_shifts (
    id BIGSERIAL PRIMARY KEY,
    record_uuid VARCHAR(64) DEFAULT '',
    shift_no VARCHAR(40) UNIQUE NOT NULL,
    cashier_name VARCHAR(120) NOT NULL DEFAULT 'Counter Staff',
    opening_cash NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    cash_sales NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    upi_sales NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    card_sales NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    cash_refunds NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    cash_payouts NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    expected_cash NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    counted_cash NUMERIC(12,2),
    variance_amount NUMERIC(12,2) DEFAULT 0.00,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    notes TEXT DEFAULT '',
    opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alterations (
    id BIGSERIAL PRIMARY KEY,
    record_uuid VARCHAR(64) DEFAULT '',
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

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_role VARCHAR(30) NOT NULL DEFAULT 'owner',
    action_type VARCHAR(60) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_ref VARCHAR(80) DEFAULT '',
    summary TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_cursors (
    device_id VARCHAR(80) PRIMARY KEY,
    last_pulled_at TIMESTAMP NOT NULL DEFAULT '1970-01-01 00:00:00',
    last_pushed_at TIMESTAMP NOT NULL DEFAULT '1970-01-01 00:00:00',
    device_name VARCHAR(160) DEFAULT '',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

async function ensureSchema(pool) {
    if (!pool || schemaInitialized.has(pool)) return;
    await pool.query(SCHEMA_SQL);
    // Optional pg_trgm for 100k+ fast substring search (ignore if restricted role)
    try {
        await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
        await pool.query("CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin (full_name gin_trgm_ops);");
        await pool.query("CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm ON customers USING gin (phone gin_trgm_ops);");
    } catch (_) {}
    schemaInitialized.add(pool);
}

/**
 * Resilient Read: tries Primary DB first, automatically falls back to Secondary DB if Primary is unreachable.
 */
async function queryRead(sql, params = []) {
    const p = getPrimaryPool();
    const s = getSecondaryPool();
    if (!p && !s) {
        throw new Error("No database configured. Set PRIMARY_DATABASE_URL (and optional SECONDARY_DATABASE_URL) in Vercel Environment Variables.");
    }
    if (p) {
        try {
            await ensureSchema(p);
            const res = await p.query(sql, params);
            res._source = "primary";
            return res;
        } catch (err) {
            if (!s) throw err;
            console.error("[DualDB] Primary read failed, failing over to Secondary:", err.message);
        }
    }
    await ensureSchema(s);
    const res = await s.query(sql, params);
    res._source = "secondary_failover";
    return res;
}

/**
 * Merged Read across BOTH Primary + Secondary (used for Excess/Archived History so archived bills remain visible).
 */
async function queryBothMerged(sql, params = [], dedupeField = "id") {
    const p = getPrimaryPool();
    const s = getSecondaryPool();
    const results = [];
    if (p) {
        try {
            await ensureSchema(p);
            const r = await p.query(sql, params);
            results.push(...r.rows);
        } catch (err) {
            console.error("[DualDB] Primary merged read error:", err.message);
        }
    }
    if (s) {
        try {
            await ensureSchema(s);
            const r = await s.query(sql, params);
            results.push(...r.rows);
        } catch (err) {
            console.error("[DualDB] Secondary merged read error:", err.message);
        }
    }
    const seen = new Set();
    const merged = [];
    for (const row of results) {
        const key = row[dedupeField];
        if (key !== undefined && key !== null) {
            if (seen.has(String(key))) continue;
            seen.add(String(key));
        }
        merged.push(row);
    }
    return merged;
}

/**
 * Execute a transactional write on Primary, with automatic Failover to Secondary if Primary fails.
 * Optionally mirrors the same transaction to Secondary so Secondary is always an up-to-date hot standby.
 */
async function runDualWrite(txFn, { mirrorToSecondary = true } = {}) {
    const p = getPrimaryPool();
    const s = getSecondaryPool();
    if (!p && !s) {
        throw new Error("No database configured. Set PRIMARY_DATABASE_URL in Vercel Environment Variables.");
    }

    async function execOn(pool) {
        await ensureSchema(pool);
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const out = await txFn(client);
            await client.query("COMMIT");
            return out;
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    }

    if (p) {
        try {
            const primaryResult = await execOn(p);
            let mirrored = false;
            if (s && mirrorToSecondary) {
                try {
                    await execOn(s);
                    mirrored = true;
                } catch (secErr) {
                    console.error("[DualDB] Secondary mirror write skipped:", secErr.message);
                }
            }
            return { result: primaryResult, writtenTo: "primary", mirrored };
        } catch (primErr) {
            if (!s) throw primErr;
            console.error("[DualDB] Primary write failed, failing over to Secondary:", primErr.message);
            const secResult = await execOn(s);
            return { result: secResult, writtenTo: "secondary_failover", mirrored: false };
        }
    }

    const secResult = await execOn(s);
    return { result: secResult, writtenTo: "secondary_only", mirrored: false };
}

/**
 * Inspect live health, latency, storage MB, and row counts of BOTH Primary & Secondary DBs.
 */
async function inspectPool(pool, label) {
    if (!pool) {
        return { label, configured: false, online: false, status: "NOT CONFIGURED" };
    }
    const t0 = Date.now();
    try {
        await ensureSchema(pool);
        const [sizeRes, countsRes] = await Promise.all([
            pool.query("SELECT pg_database_size(current_database())::bigint AS bytes"),
            pool.query(`
                SELECT
                    (SELECT COUNT(*)::int FROM garments WHERE active = TRUE) AS garments,
                    (SELECT COUNT(*)::int FROM customers) AS customers,
                    (SELECT COUNT(*)::int FROM bills) AS bills,
                    (SELECT COUNT(*)::int FROM stock_ledger) AS ledger_rows
            `),
        ]);
        const bytes = Number(sizeRes.rows[0].bytes || 0);
        const sizeMb = Number((bytes / (1024 * 1024)).toFixed(2));
        const usagePct = Math.min(100, Number(((sizeMb / PRIMARY_MAX_MB) * 100).toFixed(1)));
        return {
            label,
            configured: true,
            online: true,
            status: usagePct >= 85 ? "NEAR CAPACITY (ARCHIVE RECOMMENDED)" : "ONLINE",
            latency_ms: Date.now() - t0,
            size_mb: sizeMb,
            max_mb: PRIMARY_MAX_MB,
            usage_pct: usagePct,
            counts: countsRes.rows[0],
        };
    } catch (err) {
        return {
            label,
            configured: true,
            online: false,
            status: "OFFLINE",
            error: err.message,
            latency_ms: Date.now() - t0,
        };
    }
}

async function getDualDbStatus() {
    const [primary, secondary] = await Promise.all([
        inspectPool(getPrimaryPool(), "Primary DB (Active)"),
        inspectPool(getSecondaryPool(), "Secondary DB (Failover + Excess)"),
    ]);
    return {
        primary,
        secondary,
        failover_ready: Boolean(primary.online && secondary.online),
    };
}

/**
 * Full Mirror Sync: pushes all active Settings, Garments, Customers, Bills & Bill Items from Primary -> Secondary.
 */
async function syncPrimaryToSecondary() {
    const p = getPrimaryPool();
    const s = getSecondaryPool();
    if (!p || !s) return { ok: false, error: "Both PRIMARY_DATABASE_URL and SECONDARY_DATABASE_URL must be configured." };
    await Promise.all([ensureSchema(p), ensureSchema(s)]);

    const [settings, autos, garments, customers, bills, items] = await Promise.all([
        p.query("SELECT * FROM store_settings WHERE id = 1"),
        p.query("SELECT * FROM automation_settings WHERE id = 1"),
        p.query("SELECT * FROM garments ORDER BY id ASC"),
        p.query("SELECT * FROM customers ORDER BY id ASC"),
        p.query("SELECT * FROM bills ORDER BY id ASC"),
        p.query("SELECT * FROM bill_items ORDER BY id ASC"),
    ]);

    const sc = await s.connect();
    try {
        await sc.query("BEGIN");
        if (settings.rows[0]) {
            const st = settings.rows[0];
            await sc.query(
                `UPDATE store_settings SET store_name=$1, address_line1=$2, address_line2=$3, phone=$4, gstin=$5,
                 bill_prefix=$6, thermal_width=$7, tax_mode=$8, footer_note=$9, updated_at=CURRENT_TIMESTAMP WHERE id=1`,
                [st.store_name, st.address_line1, st.address_line2, st.phone, st.gstin, st.bill_prefix, st.thermal_width, st.tax_mode, st.footer_note]
            );
        }
        if (autos.rows[0]) {
            const a = autos.rows[0];
            await sc.query(
                `UPDATE automation_settings SET printer_mode=$1, whatsapp_enabled=$2, whatsapp_mode=$3, whatsapp_api_url=$4,
                 whatsapp_api_token=$5, whatsapp_phone_number_id=$6, whatsapp_template=$7, sms_enabled=$8, sms_provider=$9,
                 sms_api_key=$10, sms_sender_id=$11, sms_template=$12, updated_at=CURRENT_TIMESTAMP WHERE id=1`,
                [a.printer_mode, a.whatsapp_enabled, a.whatsapp_mode, a.whatsapp_api_url, a.whatsapp_api_token, a.whatsapp_phone_number_id, a.whatsapp_template, a.sms_enabled, a.sms_provider, a.sms_api_key, a.sms_sender_id, a.sms_template]
            );
        }
        for (const g of garments.rows) {
            await sc.query(
                `INSERT INTO garments (sku, barcode, name, category, sub_category, size, colour, fabric_type, rack_location, hsn_code, cost_price, mrp_price, selling_price, stock_qty, min_stock_alert, total_sold, active)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
                 ON CONFLICT (sku) DO UPDATE SET
                   barcode=EXCLUDED.barcode, name=EXCLUDED.name, category=EXCLUDED.category, size=EXCLUDED.size,
                   colour=EXCLUDED.colour, selling_price=EXCLUDED.selling_price, cost_price=EXCLUDED.cost_price,
                   stock_qty=EXCLUDED.stock_qty, total_sold=EXCLUDED.total_sold, active=EXCLUDED.active, updated_at=CURRENT_TIMESTAMP`,
                [g.sku, g.barcode, g.name, g.category, g.sub_category, g.size, g.colour, g.fabric_type, g.rack_location, g.hsn_code, g.cost_price, g.mrp_price, g.selling_price, g.stock_qty, g.min_stock_alert, g.total_sold, g.active]
            );
        }
        for (const c of customers.rows) {
            await sc.query(
                `INSERT INTO customers (customer_code, full_name, phone, email, city, address, gstin, notes, total_visits, total_items_bought, total_spent, last_purchase_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                 ON CONFLICT (phone) DO UPDATE SET
                   full_name=EXCLUDED.full_name, city=EXCLUDED.city, address=EXCLUDED.address, total_visits=EXCLUDED.total_visits,
                   total_items_bought=EXCLUDED.total_items_bought, total_spent=EXCLUDED.total_spent, last_purchase_at=EXCLUDED.last_purchase_at`,
                [c.customer_code, c.full_name, c.phone, c.email, c.city, c.address, c.gstin, c.notes, c.total_visits, c.total_items_bought, c.total_spent, c.last_purchase_at]
            );
        }
        for (const b of bills.rows) {
            const custLookup = b.customer_phone ? await sc.query("SELECT id FROM customers WHERE phone=$1 LIMIT 1", [b.customer_phone]) : { rows: [] };
            const secCustId = custLookup.rows[0]?.id || null;
            const bIns = await sc.query(
                `INSERT INTO bills (bill_no, customer_id, customer_code, customer_name, customer_phone, customer_city, payment_mode, tax_mode,
                  total_qty, subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, total_gst, grand_total, amount_received, change_returned, cash_paid, upi_paid, card_paid, notes, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
                 ON CONFLICT (bill_no) DO NOTHING RETURNING id`,
                [b.bill_no, secCustId, b.customer_code, b.customer_name, b.customer_phone, b.customer_city, b.payment_mode, b.tax_mode,
                 b.total_qty, b.subtotal, b.discount_amount, b.taxable_amount, b.cgst_amount, b.sgst_amount, b.total_gst, b.grand_total, b.amount_received, b.change_returned, b.cash_paid, b.upi_paid, b.card_paid, b.notes, b.created_at]
            );
            if (bIns.rowCount > 0) {
                const secBillId = bIns.rows[0].id;
                const bItems = items.rows.filter((it) => Number(it.bill_id) === Number(b.id));
                for (const it of bItems) {
                    await sc.query(
                        `INSERT INTO bill_items (bill_id, customer_id, sku, barcode, garment_name, category, size, colour, hsn_code, qty, unit_price, line_discount, taxable_value, gst_rate, cgst_rate, cgst_amount, sgst_rate, sgst_amount, line_total, created_at)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
                        [secBillId, secCustId, it.sku, it.barcode, it.garment_name, it.category, it.size, it.colour, it.hsn_code, it.qty, it.unit_price, it.line_discount, it.taxable_value, it.gst_rate, it.cgst_rate, it.cgst_amount, it.sgst_rate, it.sgst_amount, it.line_total, it.created_at]
                    );
                }
            }
        }
        await sc.query("COMMIT");
        return {
            ok: true,
            synced: {
                garments: garments.rowCount,
                customers: customers.rowCount,
                bills: bills.rowCount,
            },
        };
    } catch (err) {
        await sc.query("ROLLBACK").catch(() => {});
        return { ok: false, error: err.message };
    } finally {
        sc.release();
    }
}

/**
 * Excess Data Archiver: Safely mirrors older bills & logs to Secondary DB, then prunes them from Primary
 * to keep Primary fast & under quota while Secondary holds all excess historical data seamlessly.
 */
async function archiveExcessToSecondary(daysOld = 90) {
    const syncRes = await syncPrimaryToSecondary();
    if (!syncRes.ok) return syncRes;

    const p = getPrimaryPool();
    const safeDays = Math.max(7, Number(daysOld || 90));
    const cutoffSql = `CURRENT_TIMESTAMP - ($1 || ' days')::interval`;

    const [delBills, delLedger, delNotifs] = await Promise.all([
        p.query(`DELETE FROM bills WHERE created_at < ${cutoffSql}`, [safeDays]),
        p.query(`DELETE FROM stock_ledger WHERE created_at < ${cutoffSql}`, [safeDays]),
        p.query(`DELETE FROM notification_logs WHERE created_at < ${cutoffSql}`, [safeDays]),
    ]);

    return {
        ok: true,
        archived_days: safeDays,
        freed_from_primary: {
            bills: delBills.rowCount,
            stock_ledger: delLedger.rowCount,
            notification_logs: delNotifs.rowCount,
        },
    };
}

module.exports = {
    getPrimaryPool,
    getSecondaryPool,
    ensureSchema,
    queryRead,
    queryBothMerged,
    runDualWrite,
    getDualDbStatus,
    syncPrimaryToSecondary,
    archiveExcessToSecondary,
};
