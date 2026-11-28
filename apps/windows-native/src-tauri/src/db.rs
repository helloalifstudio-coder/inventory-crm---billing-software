use crate::gst::{calculate_garment_gst, round2};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, ToSql};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub fn open_conn(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn init_schema(db_path: &Path) -> Result<(), String> {
    let conn = open_conn(db_path)?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS garments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sku TEXT UNIQUE NOT NULL,
            barcode TEXT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            size TEXT NOT NULL,
            colour TEXT NOT NULL,
            fabric_type TEXT DEFAULT '',
            rack_location TEXT DEFAULT '',
            hsn_code TEXT DEFAULT '6203',
            cost_price REAL NOT NULL DEFAULT 0,
            selling_price REAL NOT NULL DEFAULT 0,
            stock_qty INTEGER NOT NULL DEFAULT 0,
            min_stock_alert INTEGER NOT NULL DEFAULT 3,
            total_sold INTEGER NOT NULL DEFAULT 0,
            record_uuid TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_code TEXT UNIQUE NOT NULL,
            full_name TEXT NOT NULL,
            phone TEXT UNIQUE NOT NULL,
            email TEXT DEFAULT '',
            city TEXT DEFAULT '',
            address TEXT DEFAULT '',
            gstin TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            total_visits INTEGER DEFAULT 0,
            total_items_bought INTEGER DEFAULT 0,
            total_spent REAL DEFAULT 0,
            last_purchase_at TEXT,
            record_uuid TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS bills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bill_no TEXT UNIQUE NOT NULL,
            customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
            customer_name TEXT DEFAULT 'Walk-in Customer',
            customer_phone TEXT DEFAULT '',
            subtotal REAL NOT NULL DEFAULT 0,
            discount_amount REAL NOT NULL DEFAULT 0,
            taxable_amount REAL NOT NULL DEFAULT 0,
            cgst_amount REAL NOT NULL DEFAULT 0,
            sgst_amount REAL NOT NULL DEFAULT 0,
            igst_amount REAL NOT NULL DEFAULT 0,
            is_igst INTEGER NOT NULL DEFAULT 0,
            total_gst REAL NOT NULL DEFAULT 0,
            grand_total REAL NOT NULL DEFAULT 0,
            total_qty INTEGER NOT NULL DEFAULT 0,
            tax_mode TEXT NOT NULL DEFAULT 'exclusive',
            payment_mode TEXT NOT NULL DEFAULT 'Cash',
            amount_received REAL NOT NULL DEFAULT 0,
            change_returned REAL NOT NULL DEFAULT 0,
            cash_paid REAL DEFAULT 0,
            upi_paid REAL DEFAULT 0,
            card_paid REAL DEFAULT 0,
            credit_note_used TEXT DEFAULT '',
            credit_note_amount REAL DEFAULT 0,
            shift_id INTEGER,
            status TEXT DEFAULT 'COMPLETED',
            record_uuid TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS bill_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
            garment_id INTEGER REFERENCES garments(id) ON DELETE SET NULL,
            sku TEXT NOT NULL,
            garment_name TEXT NOT NULL,
            size TEXT NOT NULL,
            colour TEXT NOT NULL,
            hsn_code TEXT DEFAULT '6203',
            qty INTEGER NOT NULL,
            unit_price REAL NOT NULL,
            line_discount REAL DEFAULT 0,
            taxable_value REAL NOT NULL,
            gst_rate REAL NOT NULL,
            cgst_rate REAL NOT NULL,
            cgst_amount REAL NOT NULL,
            sgst_rate REAL NOT NULL,
            sgst_amount REAL NOT NULL,
            igst_rate REAL DEFAULT 0,
            igst_amount REAL DEFAULT 0,
            line_total REAL NOT NULL,
            record_uuid TEXT
        );

        CREATE TABLE IF NOT EXISTS stock_ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            garment_id INTEGER NOT NULL REFERENCES garments(id) ON DELETE CASCADE,
            change_qty INTEGER NOT NULL,
            reason TEXT NOT NULL,
            reference_id TEXT DEFAULT '',
            record_uuid TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS store_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            store_name TEXT NOT NULL DEFAULT 'AGM SHOWROOM',
            tagline TEXT DEFAULT 'Fine Ethnic & Western Menswear',
            gstin TEXT DEFAULT '27AABCU9603R1ZM',
            phone TEXT DEFAULT '+91 98200 00000',
            address_line1 TEXT DEFAULT 'Showroom 101, Fashion Street',
            address_line2 TEXT DEFAULT 'Mumbai - 400001',
            invoice_prefix TEXT DEFAULT 'INV',
            next_bill_seq INTEGER DEFAULT 1,
            tax_mode TEXT DEFAULT 'exclusive',
            thermal_width TEXT DEFAULT '80mm',
            footer_note TEXT DEFAULT 'Thank you for shopping! Exchange within 7 days with tag intact.',
            owner_pin TEXT DEFAULT '1947',
            staff_pin TEXT DEFAULT '1234'
        );

        CREATE TABLE IF NOT EXISTS automation_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            whatsapp_enabled INTEGER DEFAULT 0,
            whatsapp_mode TEXT DEFAULT 'wa_link',
            whatsapp_api_url TEXT DEFAULT '',
            whatsapp_phone_number_id TEXT DEFAULT '',
            whatsapp_api_token TEXT DEFAULT '',
            whatsapp_template TEXT DEFAULT 'Dear {customer_name}, thank you for shopping at {store_name}! Bill {bill_no} Total: Rs.{grand_total}. Items: {items_summary}.',
            sms_enabled INTEGER DEFAULT 0,
            sms_provider TEXT DEFAULT 'fast2sms',
            sms_sender_id TEXT DEFAULT 'TXTSMS',
            sms_api_key TEXT DEFAULT '',
            sms_template TEXT DEFAULT 'Thank you for shopping at {store_name}! Bill {bill_no}, Amt Rs.{grand_total}.',
            printer_mode TEXT DEFAULT 'windows_spooler',
            cloud_sync_url TEXT DEFAULT '',
            cloud_sync_secret TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS notification_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bill_no TEXT DEFAULT '',
            customer_phone TEXT DEFAULT '',
            channel TEXT NOT NULL,
            status TEXT NOT NULL,
            provider_response TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT DEFAULT '',
            gstin TEXT DEFAULT '',
            city TEXT DEFAULT '',
            address TEXT DEFAULT '',
            balance_payable REAL DEFAULT 0,
            record_uuid TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS purchase_bills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            grn_no TEXT UNIQUE NOT NULL,
            supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
            supplier_name TEXT DEFAULT 'General',
            supplier_invoice_no TEXT DEFAULT '',
            total_qty INTEGER DEFAULT 0,
            total_amount REAL DEFAULT 0,
            notes TEXT DEFAULT '',
            record_uuid TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS returns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            return_no TEXT UNIQUE NOT NULL,
            bill_id INTEGER REFERENCES bills(id) ON DELETE SET NULL,
            bill_no TEXT NOT NULL,
            customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
            reason TEXT DEFAULT 'Size Exchange',
            refund_mode TEXT DEFAULT 'Credit Note',
            refund_amount REAL DEFAULT 0,
            credit_note_code TEXT DEFAULT '',
            record_uuid TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS return_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
            garment_id INTEGER REFERENCES garments(id) ON DELETE SET NULL,
            sku TEXT NOT NULL,
            garment_name TEXT NOT NULL,
            qty INTEGER NOT NULL,
            refund_amount REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS credit_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
            return_id INTEGER REFERENCES returns(id) ON DELETE SET NULL,
            amount REAL NOT NULL,
            redeemed_amount REAL DEFAULT 0,
            status TEXT DEFAULT 'ACTIVE',
            record_uuid TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS cash_shifts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shift_no TEXT UNIQUE NOT NULL,
            cashier_name TEXT DEFAULT 'Main Counter',
            opening_cash REAL DEFAULT 0,
            expected_cash REAL DEFAULT 0,
            closing_cash REAL,
            variance REAL,
            status TEXT DEFAULT 'OPEN',
            opened_at TEXT DEFAULT (datetime('now')),
            closed_at TEXT,
            record_uuid TEXT
        );

        CREATE TABLE IF NOT EXISTS alterations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slip_no TEXT UNIQUE NOT NULL,
            bill_no TEXT DEFAULT '',
            customer_name TEXT NOT NULL,
            customer_phone TEXT DEFAULT '',
            garment_ref TEXT DEFAULT '',
            notes TEXT NOT NULL,
            due_date TEXT DEFAULT '',
            status TEXT DEFAULT 'PENDING',
            record_uuid TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_role TEXT DEFAULT 'owner',
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_ref TEXT DEFAULT '',
            details TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sync_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            record_uuid TEXT NOT NULL,
            table_name TEXT NOT NULL,
            op_type TEXT NOT NULL DEFAULT 'upsert',
            payload_json TEXT NOT NULL,
            synced INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            synced_at TEXT
        );

        CREATE TABLE IF NOT EXISTS sync_meta (
            key TEXT PRIMARY KEY,
            value TEXT DEFAULT ''
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS customers_fts USING fts5(
            full_name, phone, city, customer_code,
            content='customers', content_rowid='id'
        );

        CREATE INDEX IF NOT EXISTS idx_bills_created ON bills(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_outbox_pending ON sync_outbox(synced, id);

        INSERT OR IGNORE INTO store_settings (id) VALUES (1);
        INSERT OR IGNORE INTO automation_settings (id) VALUES (1);
        "#,
    )
    .map_err(|e| e.to_string())?;

    // Migrate optional columns safely if upgrading older local DB
    for stmt in [
        "ALTER TABLE store_settings ADD COLUMN owner_pin TEXT DEFAULT '1947'",
        "ALTER TABLE store_settings ADD COLUMN staff_pin TEXT DEFAULT '1234'",
        "ALTER TABLE automation_settings ADD COLUMN cloud_sync_url TEXT DEFAULT ''",
        "ALTER TABLE automation_settings ADD COLUMN cloud_sync_secret TEXT DEFAULT ''",
    ] {
        let _ = conn.execute(stmt, []);
    }

    Ok(())
}

fn enqueue_outbox(conn: &Connection, table: &str, record_uuid: &str, payload: &Value) {
    let _ = conn.execute(
        "INSERT INTO sync_outbox (record_uuid, table_name, op_type, payload_json) VALUES (?1, ?2, 'upsert', ?3)",
        params![record_uuid, table, payload.to_string()],
    );
}

fn str_val(v: &Value, key: &str, default: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default.to_string())
}

fn num_val(v: &Value, key: &str, default: f64) -> f64 {
    match v.get(key) {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(default),
        Some(Value::String(s)) => s.trim().parse::<f64>().unwrap_or(default),
        _ => default,
    }
}

fn int_val(v: &Value, key: &str, default: i64) -> i64 {
    num_val(v, key, default as f64).round() as i64
}

pub fn verify_pin(db_path: &Path, pin: &str) -> Result<Option<String>, String> {
    let conn = open_conn(db_path)?;
    let (owner_pin, staff_pin): (String, String) = conn
        .query_row(
            "SELECT owner_pin, staff_pin FROM store_settings WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or_else(|_| ("1947".to_string(), "1234".to_string()));
    if pin.trim() == owner_pin.trim() {
        Ok(Some("owner".to_string()))
    } else if pin.trim() == staff_pin.trim() {
        Ok(Some("staff".to_string()))
    } else {
        Ok(None)
    }
}

fn read_settings(conn: &Connection) -> Result<Value, String> {
    conn.query_row(
        "SELECT store_name, tagline, gstin, phone, address_line1, address_line2, invoice_prefix, next_bill_seq, tax_mode, thermal_width, footer_note FROM store_settings WHERE id = 1",
        [],
        |r| {
            Ok(json!({
                "store_name": r.get::<_, String>(0)?,
                "tagline": r.get::<_, String>(1)?,
                "gstin": r.get::<_, String>(2)?,
                "phone": r.get::<_, String>(3)?,
                "address_line1": r.get::<_, String>(4)?,
                "address_line2": r.get::<_, String>(5)?,
                "invoice_prefix": r.get::<_, String>(6)?,
                "next_bill_seq": r.get::<_, i64>(7)?,
                "tax_mode": r.get::<_, String>(8)?,
                "thermal_width": r.get::<_, String>(9)?,
                "footer_note": r.get::<_, String>(10)?,
            }))
        },
    )
    .map_err(|e| e.to_string())
}

fn read_automations(conn: &Connection) -> Result<Value, String> {
    conn.query_row(
        "SELECT whatsapp_enabled, whatsapp_mode, whatsapp_api_url, whatsapp_phone_number_id, whatsapp_api_token, whatsapp_template, sms_enabled, sms_provider, sms_sender_id, sms_api_key, sms_template, printer_mode, cloud_sync_url, cloud_sync_secret FROM automation_settings WHERE id = 1",
        [],
        |r| {
            Ok(json!({
                "whatsapp_enabled": r.get::<_, i64>(0)? != 0,
                "whatsapp_mode": r.get::<_, String>(1)?,
                "whatsapp_api_url": r.get::<_, String>(2)?,
                "whatsapp_phone_number_id": r.get::<_, String>(3)?,
                "whatsapp_api_token": r.get::<_, String>(4)?,
                "whatsapp_template": r.get::<_, String>(5)?,
                "sms_enabled": r.get::<_, i64>(6)? != 0,
                "sms_provider": r.get::<_, String>(7)?,
                "sms_sender_id": r.get::<_, String>(8)?,
                "sms_api_key": r.get::<_, String>(9)?,
                "sms_template": r.get::<_, String>(10)?,
                "printer_mode": r.get::<_, String>(11)?,
                "cloud_sync_url": r.get::<_, String>(12)?,
                "cloud_sync_secret": r.get::<_, String>(13)?,
            }))
        },
    )
    .map_err(|e| e.to_string())
}

pub fn get_bootstrap(db_path: &Path) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    let settings = read_settings(&conn)?;
    let automations = read_automations(&conn)?;

    let mut stmt_g = conn
        .prepare("SELECT id, sku, barcode, name, category, size, colour, fabric_type, rack_location, hsn_code, cost_price, selling_price, stock_qty, min_stock_alert, total_sold FROM garments ORDER BY id DESC")
        .map_err(|e| e.to_string())?;
    let garments: Vec<Value> = stmt_g
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "sku": r.get::<_, String>(1)?,
                "barcode": r.get::<_, String>(2)?,
                "name": r.get::<_, String>(3)?,
                "category": r.get::<_, String>(4)?,
                "size": r.get::<_, String>(5)?,
                "colour": r.get::<_, String>(6)?,
                "fabric_type": r.get::<_, String>(7)?,
                "rack_location": r.get::<_, String>(8)?,
                "hsn_code": r.get::<_, String>(9)?,
                "cost_price": r.get::<_, f64>(10)?,
                "selling_price": r.get::<_, f64>(11)?,
                "stock_qty": r.get::<_, i64>(12)?,
                "min_stock_alert": r.get::<_, i64>(13)?,
                "total_sold": r.get::<_, i64>(14)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|x| x.ok())
        .collect();

    let kpis = conn
        .query_row(
            "SELECT
                COALESCE((SELECT SUM(grand_total) FROM bills WHERE date(created_at) = date('now') AND status != 'CANCELLED'), 0),
                COALESCE((SELECT COUNT(*) FROM bills WHERE date(created_at) = date('now') AND status != 'CANCELLED'), 0),
                COALESCE((SELECT SUM(grand_total) FROM bills WHERE status != 'CANCELLED'), 0),
                COALESCE((SELECT SUM(total_gst) FROM bills WHERE status != 'CANCELLED'), 0),
                COALESCE((SELECT SUM(cgst_amount) FROM bills WHERE status != 'CANCELLED'), 0),
                COALESCE((SELECT SUM(sgst_amount) FROM bills WHERE status != 'CANCELLED'), 0),
                COALESCE((SELECT SUM(stock_qty * selling_price) FROM garments), 0),
                COALESCE((SELECT SUM(stock_qty) FROM garments), 0),
                COALESCE((SELECT COUNT(*) FROM garments), 0),
                COALESCE((SELECT COUNT(*) FROM customers), 0),
                COALESCE((SELECT COUNT(*) FROM garments WHERE stock_qty <= min_stock_alert), 0)",
            [],
            |r| {
                Ok(json!({
                    "today_revenue": r.get::<_, f64>(0)?,
                    "today_bills": r.get::<_, i64>(1)?,
                    "total_revenue": r.get::<_, f64>(2)?,
                    "total_gst_collected": r.get::<_, f64>(3)?,
                    "total_cgst": r.get::<_, f64>(4)?,
                    "total_sgst": r.get::<_, f64>(5)?,
                    "retail_valuation": r.get::<_, f64>(6)?,
                    "total_units": r.get::<_, i64>(7)?,
                    "active_skus": r.get::<_, i64>(8)?,
                    "total_customers": r.get::<_, i64>(9)?,
                    "low_stock_count": r.get::<_, i64>(10)?,
                }))
            },
        )
        .map_err(|e| e.to_string())?;

    let mut stmt_c = conn
        .prepare("SELECT category, COUNT(*) AS sku_count, COALESCE(SUM(stock_qty),0) AS total_units, COALESCE(SUM(stock_qty * selling_price),0) AS stock_value FROM garments GROUP BY category ORDER BY stock_value DESC")
        .map_err(|e| e.to_string())?;
    let categories: Vec<Value> = stmt_c
        .query_map([], |r| {
            Ok(json!({
                "category": r.get::<_, String>(0)?,
                "sku_count": r.get::<_, i64>(1)?,
                "total_units": r.get::<_, i64>(2)?,
                "stock_value": r.get::<_, f64>(3)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|x| x.ok())
        .collect();

    let mut stmt_b = conn
        .prepare("SELECT id, bill_no, customer_name, customer_phone, payment_mode, total_gst, grand_total, status, created_at FROM bills ORDER BY id DESC LIMIT 60")
        .map_err(|e| e.to_string())?;
    let recent_bills: Vec<Value> = stmt_b
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "bill_no": r.get::<_, String>(1)?,
                "customer_name": r.get::<_, String>(2)?,
                "customer_phone": r.get::<_, String>(3)?,
                "payment_mode": r.get::<_, String>(4)?,
                "total_gst": r.get::<_, f64>(5)?,
                "grand_total": r.get::<_, f64>(6)?,
                "status": r.get::<_, String>(7)?,
                "created_at": r.get::<_, String>(8)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|x| x.ok())
        .collect();

    let mut stmt_n = conn
        .prepare("SELECT id, bill_no, customer_phone, channel, status, provider_response, created_at FROM notification_logs ORDER BY id DESC LIMIT 40")
        .map_err(|e| e.to_string())?;
    let notification_logs: Vec<Value> = stmt_n
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "bill_no": r.get::<_, String>(1)?,
                "customer_phone": r.get::<_, String>(2)?,
                "channel": r.get::<_, String>(3)?,
                "status": r.get::<_, String>(4)?,
                "provider_response": r.get::<_, String>(5)?,
                "created_at": r.get::<_, String>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|x| x.ok())
        .collect();

    let prefix = settings["invoice_prefix"].as_str().unwrap_or("INV");
    let seq = settings["next_bill_seq"].as_i64().unwrap_or(1);
    let next_bill_no = format!("{}-{:05}", prefix, seq);

    let db_bytes = fs::metadata(db_path).map(|m| m.len()).unwrap_or(0) as f64;
    let size_mb = round2(db_bytes / (1024.0 * 1024.0));
    let pending_outbox: i64 = conn
        .query_row("SELECT COUNT(*) FROM sync_outbox WHERE synced = 0", [], |r| r.get(0))
        .unwrap_or(0);
    let cloud_url = automations["cloud_sync_url"].as_str().unwrap_or("");

    let dual_db = json!({
        "primary": {
            "configured": true,
            "online": true,
            "status": "LOCAL SQLITE WAL",
            "size_mb": size_mb,
            "max_mb": 2048,
            "usage_pct": round2((size_mb / 2048.0) * 100.0),
            "latency_ms": 1,
            "counts": {
                "garments": kpis["active_skus"],
                "customers": kpis["total_customers"],
                "bills": recent_bills.len(),
                "ledger_rows": pending_outbox
            }
        },
        "secondary": {
            "configured": !cloud_url.trim().is_empty(),
            "online": !cloud_url.trim().is_empty(),
            "status": if cloud_url.trim().is_empty() { "OFFLINE MODE" } else { "CLOUD SYNC READY" },
            "size_mb": 0,
            "max_mb": 500,
            "usage_pct": 0,
            "latency_ms": 0,
            "error": if cloud_url.trim().is_empty() { "Set Cloud Sync URL in Settings for online replication" } else { "" },
            "counts": { "garments": 0, "customers": 0, "bills": 0, "ledger_rows": pending_outbox }
        }
    });

    Ok(json!({
        "ok": true,
        "settings": settings,
        "automations": automations,
        "garments": garments,
        "kpis": kpis,
        "categories": categories,
        "recent_bills": recent_bills,
        "stock_ledger": [],
        "notification_logs": notification_logs,
        "dual_db": dual_db,
        "migrations": [],
        "next_bill_no": next_bill_no,
    }))
}

pub fn save_garment(db_path: &Path, payload: &Value) -> Result<Value, String> {
    let mut conn = open_conn(db_path)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let id = payload.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
    let sku = str_val(payload, "sku", "").to_uppercase();
    let name = str_val(payload, "name", "");
    if sku.is_empty() || name.is_empty() {
        return Err("SKU and Garment Name are required.".into());
    }
    let barcode = str_val(payload, "barcode", &sku);
    let category = str_val(payload, "category", "General");
    let size = str_val(payload, "size", "Free");
    let colour = str_val(payload, "colour", "Default");
    let fabric_type = str_val(payload, "fabric_type", "");
    let rack_location = str_val(payload, "rack_location", "");
    let hsn_code = str_val(payload, "hsn_code", "6203");
    let cost_price = num_val(payload, "cost_price", 0.0).max(0.0);
    let selling_price = num_val(payload, "selling_price", 0.0).max(0.0);
    let stock_qty = int_val(payload, "stock_qty", 0).max(0);
    let min_stock_alert = int_val(payload, "min_stock_alert", 3).max(0);
    let record_uuid = Uuid::new_v4().to_string();

    if id > 0 {
        tx.execute(
            "UPDATE garments SET sku=?1, barcode=?2, name=?3, category=?4, size=?5, colour=?6, fabric_type=?7, rack_location=?8, hsn_code=?9, cost_price=?10, selling_price=?11, stock_qty=?12, min_stock_alert=?13, updated_at=datetime('now') WHERE id=?14",
            params![sku, barcode, name, category, size, colour, fabric_type, rack_location, hsn_code, cost_price, selling_price, stock_qty, min_stock_alert, id],
        ).map_err(|e| e.to_string())?;
    } else {
        tx.execute(
            "INSERT INTO garments (sku, barcode, name, category, size, colour, fabric_type, rack_location, hsn_code, cost_price, selling_price, stock_qty, min_stock_alert, record_uuid)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
             ON CONFLICT(sku) DO UPDATE SET
               name=excluded.name, category=excluded.category, size=excluded.size, colour=excluded.colour,
               fabric_type=excluded.fabric_type, rack_location=excluded.rack_location, hsn_code=excluded.hsn_code,
               cost_price=excluded.cost_price, selling_price=excluded.selling_price, stock_qty=excluded.stock_qty,
               min_stock_alert=excluded.min_stock_alert, updated_at=datetime('now')",
            params![sku, barcode, name, category, size, colour, fabric_type, rack_location, hsn_code, cost_price, selling_price, stock_qty, min_stock_alert, record_uuid],
        ).map_err(|e| e.to_string())?;
    }
    enqueue_outbox(&tx, "garments", &record_uuid, payload);
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

pub fn generate_matrix(db_path: &Path, payload: &Value) -> Result<Value, String> {
    let mut conn = open_conn(db_path)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let name = str_val(payload, "name", "");
    let prefix = str_val(payload, "sku_prefix", "MAT").to_uppercase();
    let category = str_val(payload, "category", "General");
    let rack = str_val(payload, "rack_location", "");
    let hsn = str_val(payload, "hsn_code", "6203");
    let cost = num_val(payload, "cost_price", 0.0).max(0.0);
    let price = num_val(payload, "selling_price", 0.0).max(0.0);
    let qty = int_val(payload, "stock_qty", 0).max(0);

    let sizes: Vec<String> = payload
        .get("sizes")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.trim().to_string())).collect())
        .unwrap_or_default();
    let colours: Vec<String> = payload
        .get("colours")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.trim().to_string())).collect())
        .unwrap_or_default();

    if name.is_empty() || sizes.is_empty() || colours.is_empty() {
        return Err("Garment name, sizes, and colours are required.".into());
    }

    let mut created = 0i64;
    for sz in &sizes {
        for col in &colours {
            let col_code: String = col.chars().filter(|c| c.is_alphanumeric()).take(3).collect::<String>().to_uppercase();
            let sku = format!("{}-{}-{}", prefix, sz.to_uppercase(), col_code);
            let ruuid = Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO garments (sku, barcode, name, category, size, colour, rack_location, hsn_code, cost_price, selling_price, stock_qty, record_uuid)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
                 ON CONFLICT(sku) DO NOTHING",
                params![sku, sku, name, category, sz, col, rack, hsn, cost, price, qty, ruuid],
            )
            .map_err(|e| e.to_string())?;
            created += 1;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "created": created }))
}

pub fn adjust_stock(db_path: &Path, payload: &Value) -> Result<Value, String> {
    let mut conn = open_conn(db_path)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let id = int_val(payload, "id", 0);
    let delta = int_val(payload, "delta", 0);
    let reason = str_val(payload, "reason", "Manual Stock Adjustment");
    tx.execute(
        "UPDATE garments SET stock_qty = MAX(0, stock_qty + ?1), updated_at = datetime('now') WHERE id = ?2",
        params![delta, id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO stock_ledger (garment_id, change_qty, reason) VALUES (?1, ?2, ?3)",
        params![id, delta, reason],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

pub fn delete_garment(db_path: &Path, id: i64) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    conn.execute("DELETE FROM garments WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

pub fn list_customers(db_path: &Path, payload: &Value) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    let q = str_val(payload, "q", "").trim().to_string();
    let page = int_val(payload, "page", 1).max(1);
    let page_size = int_val(payload, "pageSize", 25).clamp(1, 200);
    let offset = (page - 1) * page_size;
    let like = format!("%{}%", q);

    let total: i64 = if q.is_empty() {
        conn.query_row("SELECT COUNT(*) FROM customers", [], |r| r.get(0))
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM customers WHERE full_name LIKE ?1 OR phone LIKE ?1 OR customer_code LIKE ?1 OR city LIKE ?1",
            params![like],
            |r| r.get(0),
        )
    }
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, customer_code, full_name, phone, city, total_visits, total_items_bought, total_spent, last_purchase_at
             FROM customers
             WHERE (?1 = '' OR full_name LIKE ?2 OR phone LIKE ?2 OR customer_code LIKE ?2 OR city LIKE ?2)
             ORDER BY COALESCE(last_purchase_at, created_at) DESC, id DESC
             LIMIT ?3 OFFSET ?4",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<Value> = stmt
        .query_map(params![q, like, page_size, offset], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "customer_code": r.get::<_, String>(1)?,
                "full_name": r.get::<_, String>(2)?,
                "phone": r.get::<_, String>(3)?,
                "city": r.get::<_, String>(4)?,
                "total_visits": r.get::<_, i64>(5)?,
                "total_items_bought": r.get::<_, i64>(6)?,
                "total_spent": r.get::<_, f64>(7)?,
                "last_purchase_at": r.get::<_, Option<String>>(8)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|x| x.ok())
        .collect();

    let total_pages = ((total as f64) / (page_size as f64)).ceil().max(1.0) as i64;
    Ok(json!({ "ok": true, "rows": rows, "total": total, "page": page, "totalPages": total_pages }))
}

pub fn find_customer_by_phone(db_path: &Path, phone: &str) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    let p = phone.trim();
    let row = conn
        .query_row(
            "SELECT id, customer_code, full_name, phone, city, total_visits, total_spent FROM customers WHERE phone = ?1",
            params![p],
            |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "customer_code": r.get::<_, String>(1)?,
                    "full_name": r.get::<_, String>(2)?,
                    "phone": r.get::<_, String>(3)?,
                    "city": r.get::<_, String>(4)?,
                    "total_visits": r.get::<_, i64>(5)?,
                    "total_spent": r.get::<_, f64>(6)?,
                }))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "customer": row }))
}

pub fn get_customer_history(db_path: &Path, customer_id: i64) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    let customer = conn
        .query_row(
            "SELECT id, customer_code, full_name, phone, email, city, address, gstin, notes, total_visits, total_items_bought, total_spent, last_purchase_at FROM customers WHERE id = ?1",
            params![customer_id],
            |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "customer_code": r.get::<_, String>(1)?,
                    "full_name": r.get::<_, String>(2)?,
                    "phone": r.get::<_, String>(3)?,
                    "email": r.get::<_, String>(4)?,
                    "city": r.get::<_, String>(5)?,
                    "address": r.get::<_, String>(6)?,
                    "gstin": r.get::<_, String>(7)?,
                    "notes": r.get::<_, String>(8)?,
                    "total_visits": r.get::<_, i64>(9)?,
                    "total_items_bought": r.get::<_, i64>(10)?,
                    "total_spent": r.get::<_, f64>(11)?,
                    "last_purchase_at": r.get::<_, Option<String>>(12)?,
                }))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let mut stmt_b = conn
        .prepare("SELECT id, bill_no, payment_mode, total_qty, grand_total, customer_phone, created_at FROM bills WHERE customer_id = ?1 ORDER BY id DESC")
        .map_err(|e| e.to_string())?;
    let bills: Vec<Value> = stmt_b
        .query_map(params![customer_id], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "bill_no": r.get::<_, String>(1)?,
                "payment_mode": r.get::<_, String>(2)?,
                "total_qty": r.get::<_, i64>(3)?,
                "grand_total": r.get::<_, f64>(4)?,
                "customer_phone": r.get::<_, String>(5)?,
                "created_at": r.get::<_, String>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|x| x.ok())
        .collect();

    let mut stmt_i = conn
        .prepare("SELECT b.bill_no, bi.sku, bi.garment_name, bi.size, bi.colour, bi.qty, bi.line_total, g.category FROM bill_items bi JOIN bills b ON b.id = bi.bill_id LEFT JOIN garments g ON g.id = bi.garment_id WHERE b.customer_id = ?1 ORDER BY bi.id DESC")
        .map_err(|e| e.to_string())?;
    let purchased_items: Vec<Value> = stmt_i
        .query_map(params![customer_id], |r| {
            Ok(json!({
                "bill_no": r.get::<_, String>(0)?,
                "sku": r.get::<_, String>(1)?,
                "garment_name": r.get::<_, String>(2)?,
                "size": r.get::<_, String>(3)?,
                "colour": r.get::<_, String>(4)?,
                "qty": r.get::<_, i64>(5)?,
                "line_total": r.get::<_, f64>(6)?,
                "category": r.get::<_, Option<String>>(7)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|x| x.ok())
        .collect();

    Ok(json!({ "ok": true, "customer": customer, "bills": bills, "purchased_items": purchased_items }))
}

pub fn save_customer(db_path: &Path, payload: &Value) -> Result<Value, String> {
    let mut conn = open_conn(db_path)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let id = payload.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
    let full_name = str_val(payload, "full_name", "");
    let phone = str_val(payload, "phone", "");
    if full_name.is_empty() || phone.is_empty() {
        return Err("Full name and phone are required.".into());
    }
    let email = str_val(payload, "email", "");
    let city = str_val(payload, "city", "");
    let address = str_val(payload, "address", "");
    let gstin = str_val(payload, "gstin", "");
    let notes = str_val(payload, "notes", "");
    let ruuid = Uuid::new_v4().to_string();

    let cid: i64 = if id > 0 {
        tx.execute(
            "UPDATE customers SET full_name=?1, phone=?2, email=?3, city=?4, address=?5, gstin=?6, notes=?7, updated_at=datetime('now') WHERE id=?8",
            params![full_name, phone, email, city, address, gstin, notes, id],
        ).map_err(|e| e.to_string())?;
        id
    } else {
        let code = format!("CUST-{}", &ruuid[..8].to_uppercase());
        tx.execute(
            "INSERT INTO customers (customer_code, full_name, phone, email, city, address, gstin, notes, record_uuid)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
             ON CONFLICT(phone) DO UPDATE SET
               full_name=excluded.full_name, email=excluded.email, city=excluded.city,
               address=excluded.address, gstin=excluded.gstin, notes=excluded.notes, updated_at=datetime('now')",
            params![code, full_name, phone, email, city, address, gstin, notes, ruuid],
        ).map_err(|e| e.to_string())?;
        tx.query_row("SELECT id FROM customers WHERE phone = ?1", params![phone], |r| r.get(0))
            .map_err(|e| e.to_string())?
    };

    enqueue_outbox(&tx, "customers", &ruuid, payload);
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "customer": { "id": cid, "full_name": full_name, "phone": phone } }))
}

pub fn checkout_bill(db_path: &Path, payload: &Value) -> Result<Value, String> {
    let mut conn = open_conn(db_path)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let items_in = payload
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if items_in.is_empty() {
        return Err("Cart is empty.".into());
    }

    let settings = read_settings(&tx)?;
    let prefix = settings["invoice_prefix"].as_str().unwrap_or("INV");
    let seq = settings["next_bill_seq"].as_i64().unwrap_or(1);
    let bill_no = format!("{}-{:05}", prefix, seq);

    let tax_mode = str_val(payload, "tax_mode", "exclusive");
    let payment_mode = str_val(payload, "payment_mode", "Cash");
    let cust_phone = str_val(payload, "customer_phone", "");
    let cust_name = str_val(payload, "customer_name", "Walk-in Customer");
    let cust_city = str_val(payload, "customer_city", "");
    let is_igst = payload.get("is_igst").and_then(|v| v.as_bool()).unwrap_or(false);
    let bill_discount = num_val(payload, "bill_discount", 0.0).max(0.0);
    let cn_code = str_val(payload, "credit_note_no", "");

    let custom_enabled = payload.get("custom_gst_enabled").and_then(|v| v.as_bool()).unwrap_or(false);
    let custom_cgst = if custom_enabled { Some(num_val(payload, "custom_cgst_rate", 2.5)) } else { None };
    let custom_sgst = if custom_enabled { Some(num_val(payload, "custom_sgst_rate", 2.5)) } else { None };

    // Upsert customer if phone present
    let customer_id: Option<i64> = if !cust_phone.is_empty() {
        let ruuid = Uuid::new_v4().to_string();
        let code = format!("CUST-{}", &ruuid[..8].to_uppercase());
        tx.execute(
            "INSERT INTO customers (customer_code, full_name, phone, city, record_uuid)
             VALUES (?1,?2,?3,?4,?5)
             ON CONFLICT(phone) DO UPDATE SET full_name=excluded.full_name, city=COALESCE(NULLIF(excluded.city,''), customers.city), updated_at=datetime('now')",
            params![code, cust_name, cust_phone, cust_city, ruuid],
        ).map_err(|e| e.to_string())?;
        tx.query_row("SELECT id FROM customers WHERE phone = ?1", params![cust_phone], |r| r.get(0)).ok()
    } else {
        None
    };

    // Compute proportional bill_discount allocation per line
    let line_grosses: Vec<f64> = items_in
        .iter()
        .map(|it| (num_val(it, "selling_price", 0.0) * (int_val(it, "qty", 1).max(1) as f64) - num_val(it, "line_discount", 0.0)).max(0.0))
        .collect();
    let gross_sum: f64 = line_grosses.iter().sum();

    let mut subtotal = 0.0;
    let mut taxable_sum = 0.0;
    let mut cgst_sum = 0.0;
    let mut sgst_sum = 0.0;
    let mut igst_sum = 0.0;
    let mut grand_total = 0.0;
    let mut total_qty = 0i64;
    let mut computed_lines: Vec<(i64, Value, crate::gst::GstLineResult)> = Vec::new();

    for (idx, it) in items_in.iter().enumerate() {
        let gid = int_val(it, "id", 0);
        let qty = int_val(it, "qty", 1).max(1);
        let price = num_val(it, "selling_price", 0.0).max(0.0);
        let extra_disc = if gross_sum > 0.0 && bill_discount > 0.0 {
            round2((line_grosses[idx] / gross_sum) * bill_discount)
        } else {
            0.0
        };
        let total_disc = num_val(it, "line_discount", 0.0).max(0.0) + extra_disc;
        let calc = calculate_garment_gst(price, qty, total_disc, &tax_mode, custom_cgst, custom_sgst, is_igst);
        subtotal += price * (qty as f64);
        taxable_sum += calc.taxable_value;
        cgst_sum += calc.cgst_amount;
        sgst_sum += calc.sgst_amount;
        igst_sum += calc.igst_amount;
        grand_total += calc.line_total;
        total_qty += qty;
        computed_lines.push((gid, it.clone(), calc));
    }

    subtotal = round2(subtotal);
    taxable_sum = round2(taxable_sum);
    cgst_sum = round2(cgst_sum);
    sgst_sum = round2(sgst_sum);
    igst_sum = round2(igst_sum);
    let total_gst = round2(cgst_sum + sgst_sum + igst_sum);
    grand_total = round2(grand_total);

    let mut cn_applied = 0.0;
    if !cn_code.is_empty() {
        let cn_row: Option<(i64, f64, f64, String)> = tx
            .query_row(
                "SELECT id, amount, redeemed_amount, status FROM credit_notes WHERE code = ?1",
                params![cn_code],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((cn_id, amt, used, st)) = cn_row {
            if st == "ACTIVE" && amt > used {
                cn_applied = round2((amt - used).min(grand_total));
                grand_total = round2((grand_total - cn_applied).max(0.0));
                let new_used = round2(used + cn_applied);
                let new_st = if new_used >= amt { "REDEEMED" } else { "ACTIVE" };
                tx.execute(
                    "UPDATE credit_notes SET redeemed_amount=?1, status=?2 WHERE id=?3",
                    params![new_used, new_st, cn_id],
                ).map_err(|e| e.to_string())?;
            }
        }
    }

    let cash_paid = num_val(payload, "cash_paid", 0.0);
    let upi_paid = num_val(payload, "upi_paid", 0.0);
    let card_paid = num_val(payload, "card_paid", 0.0);
    let amount_received = match payload.get("amount_received") {
        Some(Value::String(s)) if s.trim().is_empty() => grand_total,
        Some(Value::Null) => grand_total,
        _ => num_val(payload, "amount_received", grand_total),
    };
    let change_returned = round2((amount_received - grand_total).max(0.0));
    let active_shift: Option<i64> = tx
        .query_row("SELECT id FROM cash_shifts WHERE status='OPEN' ORDER BY id DESC LIMIT 1", [], |r| r.get(0))
        .ok();
    let bill_uuid = Uuid::new_v4().to_string();
    let is_igst_i: i64 = if is_igst { 1 } else { 0 };

    let bill_params: [&dyn ToSql; 23] = [
        &bill_no, &customer_id, &cust_name, &cust_phone, &subtotal, &bill_discount, &taxable_sum,
        &cgst_sum, &sgst_sum, &igst_sum, &is_igst_i, &total_gst, &grand_total, &total_qty,
        &tax_mode, &payment_mode, &amount_received, &change_returned, &cash_paid, &upi_paid,
        &card_paid, &cn_code, &cn_applied,
    ];
    tx.execute(
        "INSERT INTO bills (bill_no, customer_id, customer_name, customer_phone, subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, is_igst, total_gst, grand_total, total_qty, tax_mode, payment_mode, amount_received, change_returned, cash_paid, upi_paid, card_paid, credit_note_used, credit_note_amount)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)",
        bill_params.as_slice(),
    ).map_err(|e| e.to_string())?;
    let bill_id = tx.last_insert_rowid();
    tx.execute(
        "UPDATE bills SET shift_id=?1, record_uuid=?2 WHERE id=?3",
        params![active_shift, bill_uuid, bill_id],
    ).map_err(|e| e.to_string())?;

    let mut out_items = Vec::new();
    for (gid, it, calc) in computed_lines {
        let sku = str_val(&it, "sku", "SKU");
        let gname = str_val(&it, "name", "Garment");
        let size = str_val(&it, "size", "Free");
        let colour = str_val(&it, "colour", "");
        let hsn = str_val(&it, "hsn_code", "6203");
        let line_uuid = Uuid::new_v4().to_string();
        let gid_opt: Option<i64> = if gid > 0 { Some(gid) } else { None };
        let item_params: [&dyn ToSql; 19] = [
            &bill_id, &gid_opt, &sku, &gname, &size, &colour, &hsn, &calc.qty, &calc.unit_price,
            &calc.line_discount, &calc.taxable_value, &calc.gst_rate, &calc.cgst_rate, &calc.cgst_amount,
            &calc.sgst_rate, &calc.sgst_amount, &calc.igst_rate, &calc.igst_amount, &calc.line_total,
        ];
        tx.execute(
            "INSERT INTO bill_items (bill_id, garment_id, sku, garment_name, size, colour, hsn_code, qty, unit_price, line_discount, taxable_value, gst_rate, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, line_total)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
            item_params.as_slice(),
        ).map_err(|e| e.to_string())?;

        if gid > 0 {
            tx.execute(
                "UPDATE garments SET stock_qty = MAX(0, stock_qty - ?1), total_sold = total_sold + ?1, updated_at=datetime('now') WHERE id=?2",
                params![calc.qty, gid],
            ).map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO stock_ledger (garment_id, change_qty, reason, reference_id) VALUES (?1, ?2, 'POS Sale', ?3)",
                params![gid, -calc.qty, bill_no],
            ).map_err(|e| e.to_string())?;
        }
        out_items.push(json!({
            "garment_id": gid, "sku": sku, "garment_name": gname, "size": size, "colour": colour,
            "qty": calc.qty, "unit_price": calc.unit_price, "gst_rate": calc.gst_rate,
            "line_total": calc.line_total, "record_uuid": line_uuid
        }));
    }

    if let Some(cid) = customer_id {
        tx.execute(
            "UPDATE customers SET total_visits = total_visits + 1, total_items_bought = total_items_bought + ?1, total_spent = total_spent + ?2, last_purchase_at = datetime('now'), updated_at = datetime('now') WHERE id = ?3",
            params![total_qty, grand_total, cid],
        ).map_err(|e| e.to_string())?;
    }

    if let Some(sid) = active_shift {
        let cash_delta = if payment_mode == "Cash" {
            grand_total
        } else if payment_mode == "Split" {
            cash_paid
        } else {
            0.0
        };
        if cash_delta > 0.0 {
            tx.execute(
                "UPDATE cash_shifts SET expected_cash = expected_cash + ?1 WHERE id = ?2",
                params![cash_delta, sid],
            ).map_err(|e| e.to_string())?;
        }
    }

    tx.execute("UPDATE store_settings SET next_bill_seq = next_bill_seq + 1 WHERE id = 1", [])
        .map_err(|e| e.to_string())?;

    let bill_json = json!({
        "id": bill_id,
        "bill_no": bill_no,
        "customer_id": customer_id,
        "customer_name": cust_name,
        "customer_phone": cust_phone,
        "subtotal": subtotal,
        "discount_amount": bill_discount,
        "taxable_amount": taxable_sum,
        "cgst_amount": cgst_sum,
        "sgst_amount": sgst_sum,
        "igst_amount": igst_sum,
        "is_igst": is_igst,
        "total_gst": total_gst,
        "grand_total": grand_total,
        "total_qty": total_qty,
        "tax_mode": tax_mode,
        "payment_mode": payment_mode,
        "amount_received": amount_received,
        "change_returned": change_returned,
        "credit_note_used": cn_code,
        "credit_note_amount": cn_applied,
        "created_at": Utc::now().to_rfc3339(),
    });
    enqueue_outbox(&tx, "bills", &bill_uuid, &bill_json);
    tx.commit().map_err(|e| e.to_string())?;

    Ok(json!({
        "ok": true,
        "bill_no": bill_no,
        "next_bill_no": format!("{}-{:05}", prefix, seq + 1),
        "bill": bill_json,
        "items": out_items,
        "notification_results": []
    }))
}

pub fn get_bill_detail(db_path: &Path, key: &str) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    let k = key.trim();
    let id_num = k.parse::<i64>().unwrap_or(-1);
    let bill = conn
        .query_row(
            "SELECT id, bill_no, customer_name, customer_phone, subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, is_igst, total_gst, grand_total, total_qty, tax_mode, payment_mode, amount_received, change_returned, credit_note_used, created_at FROM bills WHERE id = ?1 OR bill_no = ?2",
            params![id_num, k],
            |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "bill_no": r.get::<_, String>(1)?,
                    "customer_name": r.get::<_, String>(2)?,
                    "customer_phone": r.get::<_, String>(3)?,
                    "subtotal": r.get::<_, f64>(4)?,
                    "discount_amount": r.get::<_, f64>(5)?,
                    "taxable_amount": r.get::<_, f64>(6)?,
                    "cgst_amount": r.get::<_, f64>(7)?,
                    "sgst_amount": r.get::<_, f64>(8)?,
                    "igst_amount": r.get::<_, f64>(9)?,
                    "is_igst": r.get::<_, i64>(10)? != 0,
                    "total_gst": r.get::<_, f64>(11)?,
                    "grand_total": r.get::<_, f64>(12)?,
                    "total_qty": r.get::<_, i64>(13)?,
                    "tax_mode": r.get::<_, String>(14)?,
                    "payment_mode": r.get::<_, String>(15)?,
                    "amount_received": r.get::<_, f64>(16)?,
                    "change_returned": r.get::<_, f64>(17)?,
                    "credit_note_used": r.get::<_, String>(18)?,
                    "created_at": r.get::<_, String>(19)?,
                }))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some(bill_v) = bill else {
        return Ok(json!({ "ok": false, "error": "Bill not found" }));
    };
    let bid = bill_v["id"].as_i64().unwrap_or(0);
    let mut stmt = conn
        .prepare("SELECT garment_id, sku, garment_name, size, colour, qty, unit_price, line_total FROM bill_items WHERE bill_id = ?1")
        .map_err(|e| e.to_string())?;
    let items: Vec<Value> = stmt
        .query_map(params![bid], |r| {
            Ok(json!({
                "garment_id": r.get::<_, Option<i64>>(0)?,
                "sku": r.get::<_, String>(1)?,
                "garment_name": r.get::<_, String>(2)?,
                "size": r.get::<_, String>(3)?,
                "colour": r.get::<_, String>(4)?,
                "qty": r.get::<_, i64>(5)?,
                "unit_price": r.get::<_, f64>(6)?,
                "line_total": r.get::<_, f64>(7)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|x| x.ok())
        .collect();

    Ok(json!({ "ok": true, "bill": bill_v, "items": items }))
}

pub fn return_bill(db_path: &Path, payload: &Value) -> Result<Value, String> {
    let mut conn = open_conn(db_path)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let bill_id = payload.get("bill_id").and_then(|v| v.as_i64());
    let bill_no = str_val(payload, "bill_no", "");
    let reason = str_val(payload, "reason", "Size Exchange");
    let refund_mode = str_val(payload, "refund_mode", "Credit Note");
    let items = payload.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if bill_no.is_empty() || items.is_empty() {
        return Err("Bill number and return items are required.".into());
    }
    let ruuid = Uuid::new_v4().to_string();
    let return_no = format!("RET-{}", &ruuid[..6].to_uppercase());
    let refund_total: f64 = round2(items.iter().map(|i| num_val(i, "refund_amount", 0.0)).sum());
    let cn_code = if refund_mode == "Credit Note" {
        format!("CN-{}", &ruuid[..6].to_uppercase())
    } else {
        String::new()
    };

    tx.execute(
        "INSERT INTO returns (return_no, bill_id, bill_no, reason, refund_mode, refund_amount, credit_note_code, record_uuid) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![return_no, bill_id, bill_no, reason, refund_mode, refund_total, cn_code, ruuid],
    ).map_err(|e| e.to_string())?;
    let ret_id = tx.last_insert_rowid();

    for it in &items {
        let gid = it.get("garment_id").and_then(|v| v.as_i64());
        let sku = str_val(it, "sku", "SKU");
        let gname = str_val(it, "garment_name", "Garment");
        let qty = int_val(it, "qty", 1).max(1);
        let ramt = num_val(it, "refund_amount", 0.0);
        tx.execute(
            "INSERT INTO return_items (return_id, garment_id, sku, garment_name, qty, refund_amount) VALUES (?1,?2,?3,?4,?5,?6)",
            params![ret_id, gid, sku, gname, qty, ramt],
        ).map_err(|e| e.to_string())?;
        if let Some(g) = gid {
            tx.execute(
                "UPDATE garments SET stock_qty = stock_qty + ?1, updated_at = datetime('now') WHERE id = ?2",
                params![qty, g],
            ).map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO stock_ledger (garment_id, change_qty, reason, reference_id) VALUES (?1, ?2, 'Sales Return', ?3)",
                params![g, qty, return_no],
            ).map_err(|e| e.to_string())?;
        }
    }

    if !cn_code.is_empty() {
        tx.execute(
            "INSERT INTO credit_notes (code, return_id, amount, status, record_uuid) VALUES (?1,?2,?3,'ACTIVE',?4)",
            params![cn_code, ret_id, refund_total, Uuid::new_v4().to_string()],
        ).map_err(|e| e.to_string())?;
    }
    if let Some(bid) = bill_id {
        tx.execute("UPDATE bills SET status = 'RETURNED' WHERE id = ?1", params![bid])
            .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "INSERT INTO audit_logs (action, entity_type, entity_ref, details) VALUES ('RETURN_BILL','bills',?1,?2)",
        params![bill_no, json!({ "return_no": return_no, "refund_amount": refund_total }).to_string()],
    ).map_err(|e| e.to_string())?;

    enqueue_outbox(&tx, "returns", &ruuid, payload);
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "return_no": return_no, "credit_note_code": cn_code, "refund_amount": refund_total }))
}

pub fn save_settings(db_path: &Path, payload: &Value) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    conn.execute(
        "UPDATE store_settings SET store_name=?1, tagline=?2, gstin=?3, phone=?4, address_line1=?5, address_line2=?6, invoice_prefix=?7, tax_mode=?8, thermal_width=?9, footer_note=?10 WHERE id=1",
        params![
            str_val(payload, "store_name", "AGM SHOWROOM"),
            str_val(payload, "tagline", ""),
            str_val(payload, "gstin", ""),
            str_val(payload, "phone", ""),
            str_val(payload, "address_line1", ""),
            str_val(payload, "address_line2", ""),
            str_val(payload, "invoice_prefix", "INV"),
            str_val(payload, "tax_mode", "exclusive"),
            str_val(payload, "thermal_width", "80mm"),
            str_val(payload, "footer_note", ""),
        ],
    ).map_err(|e| e.to_string())?;
    let owner_pin = str_val(payload, "owner_pin", "");
    let staff_pin = str_val(payload, "staff_pin", "");
    if !owner_pin.is_empty() {
        conn.execute("UPDATE store_settings SET owner_pin=?1 WHERE id=1", params![owner_pin]).map_err(|e| e.to_string())?;
    }
    if !staff_pin.is_empty() {
        conn.execute("UPDATE store_settings SET staff_pin=?1 WHERE id=1", params![staff_pin]).map_err(|e| e.to_string())?;
    }
    Ok(json!({ "ok": true }))
}

pub fn save_automations(db_path: &Path, payload: &Value) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    let wa_on: i64 = if payload.get("whatsapp_enabled").and_then(|v| v.as_bool()).unwrap_or(false) { 1 } else { 0 };
    let sms_on: i64 = if payload.get("sms_enabled").and_then(|v| v.as_bool()).unwrap_or(false) { 1 } else { 0 };
    conn.execute(
        "UPDATE automation_settings SET whatsapp_enabled=?1, whatsapp_mode=?2, whatsapp_api_url=?3, whatsapp_phone_number_id=?4, whatsapp_api_token=?5, whatsapp_template=?6, sms_enabled=?7, sms_provider=?8, sms_sender_id=?9, sms_api_key=?10, sms_template=?11, printer_mode=?12 WHERE id=1",
        params![
            wa_on,
            str_val(payload, "whatsapp_mode", "wa_link"),
            str_val(payload, "whatsapp_api_url", ""),
            str_val(payload, "whatsapp_phone_number_id", ""),
            str_val(payload, "whatsapp_api_token", ""),
            str_val(payload, "whatsapp_template", ""),
            sms_on,
            str_val(payload, "sms_provider", "fast2sms"),
            str_val(payload, "sms_sender_id", "TXTSMS"),
            str_val(payload, "sms_api_key", ""),
            str_val(payload, "sms_template", ""),
            str_val(payload, "printer_mode", "windows_spooler"),
        ],
    ).map_err(|e| e.to_string())?;
    let cloud_url = str_val(payload, "cloud_sync_url", "");
    let cloud_sec = str_val(payload, "cloud_sync_secret", "");
    if !cloud_url.is_empty() || !cloud_sec.is_empty() {
        conn.execute(
            "UPDATE automation_settings SET cloud_sync_url=?1, cloud_sync_secret=?2 WHERE id=1",
            params![cloud_url, cloud_sec],
        ).map_err(|e| e.to_string())?;
    }
    Ok(json!({ "ok": true }))
}

pub fn retail_overview(db_path: &Path) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    let mut s1 = conn.prepare("SELECT id, name, phone, gstin, city FROM suppliers ORDER BY id DESC").map_err(|e| e.to_string())?;
    let suppliers: Vec<Value> = s1
        .query_map([], |r| Ok(json!({"id": r.get::<_, i64>(0)?, "name": r.get::<_, String>(1)?, "phone": r.get::<_, String>(2)?, "gstin": r.get::<_, String>(3)?, "city": r.get::<_, String>(4)?})))
        .map_err(|e| e.to_string())?.filter_map(|x| x.ok()).collect();
    let mut s2 = conn.prepare("SELECT id, grn_no, supplier_name, supplier_invoice_no, total_qty, total_amount, created_at FROM purchase_bills ORDER BY id DESC LIMIT 40").map_err(|e| e.to_string())?;
    let purchases: Vec<Value> = s2
        .query_map([], |r| Ok(json!({"id": r.get::<_, i64>(0)?, "grn_no": r.get::<_, String>(1)?, "supplier_name": r.get::<_, String>(2)?, "supplier_invoice_no": r.get::<_, String>(3)?, "total_qty": r.get::<_, i64>(4)?, "total_amount": r.get::<_, f64>(5)?, "created_at": r.get::<_, String>(6)?})))
        .map_err(|e| e.to_string())?.filter_map(|x| x.ok()).collect();
    Ok(json!({ "ok": true, "suppliers": suppliers, "purchases": purchases }))
}

pub fn save_supplier(db_path: &Path, payload: &Value) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    let name = str_val(payload, "name", "");
    if name.is_empty() { return Err("Supplier name required".into()); }
    conn.execute(
        "INSERT INTO suppliers (name, phone, gstin, city, record_uuid) VALUES (?1,?2,?3,?4,?5)",
        params![name, str_val(payload, "phone", ""), str_val(payload, "gstin", ""), str_val(payload, "city", ""), Uuid::new_v4().to_string()],
    ).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

pub fn record_purchase(db_path: &Path, payload: &Value) -> Result<Value, String> {
    let mut conn = open_conn(db_path)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let items = payload.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if items.is_empty() { return Err("Purchase items required".into()); }
    let sup_id = payload.get("supplier_id").and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())));
    let sup_name: String = sup_id
        .and_then(|id| tx.query_row("SELECT name FROM suppliers WHERE id=?1", params![id], |r| r.get(0)).ok())
        .unwrap_or_else(|| "General Supplier".into());
    let mut tq = 0i64;
    let mut ta = 0.0f64;
    let ruuid = Uuid::new_v4().to_string();
    let grn_no = format!("GRN-{}", &ruuid[..6].to_uppercase());
    for it in &items {
        let gid = int_val(it, "garment_id", 0);
        let q = int_val(it, "qty", 0).max(1);
        let cost = num_val(it, "cost_price", 0.0).max(0.0);
        tq += q;
        ta += cost * (q as f64);
        if gid > 0 {
            tx.execute("UPDATE garments SET stock_qty = stock_qty + ?1, cost_price = CASE WHEN ?2 > 0 THEN ?2 ELSE cost_price END, updated_at=datetime('now') WHERE id=?3", params![q, cost, gid]).map_err(|e| e.to_string())?;
            tx.execute("INSERT INTO stock_ledger (garment_id, change_qty, reason, reference_id) VALUES (?1,?2,'Purchase GRN',?3)", params![gid, q, grn_no]).map_err(|e| e.to_string())?;
        }
    }
    tx.execute(
        "INSERT INTO purchase_bills (grn_no, supplier_id, supplier_name, supplier_invoice_no, total_qty, total_amount, record_uuid) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![grn_no, sup_id, sup_name, str_val(payload, "supplier_invoice_no", ""), tq, round2(ta), ruuid],
    ).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "grn_no": grn_no }))
}

pub fn list_returns(db_path: &Path) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    let mut st = conn.prepare("SELECT id, return_no, bill_no, reason, refund_mode, refund_amount, credit_note_code, created_at FROM returns ORDER BY id DESC LIMIT 50").map_err(|e| e.to_string())?;
    let rows: Vec<Value> = st.query_map([], |r| Ok(json!({"id": r.get::<_, i64>(0)?, "return_no": r.get::<_, String>(1)?, "bill_no": r.get::<_, String>(2)?, "reason": r.get::<_, String>(3)?, "refund_mode": r.get::<_, String>(4)?, "refund_amount": r.get::<_, f64>(5)?, "credit_note_code": r.get::<_, String>(6)?, "created_at": r.get::<_, String>(7)?}))).map_err(|e| e.to_string())?.filter_map(|x| x.ok()).collect();
    Ok(json!({ "ok": true, "returns": rows }))
}

pub fn check_credit_note(db_path: &Path, code: &str) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    let row = conn.query_row("SELECT code, amount, redeemed_amount, status FROM credit_notes WHERE code=?1", params![code.trim()], |r| Ok(json!({"code": r.get::<_, String>(0)?, "amount": r.get::<_, f64>(1)?, "redeemed_amount": r.get::<_, f64>(2)?, "status": r.get::<_, String>(3)?}))).optional().map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "credit_note": row }))
}

pub fn list_shifts(db_path: &Path) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    let mut st = conn.prepare("SELECT id, shift_no, cashier_name, opening_cash, expected_cash, closing_cash, variance, status, opened_at, closed_at FROM cash_shifts ORDER BY id DESC LIMIT 40").map_err(|e| e.to_string())?;
    let rows: Vec<Value> = st.query_map([], |r| Ok(json!({"id": r.get::<_, i64>(0)?, "shift_no": r.get::<_, String>(1)?, "cashier_name": r.get::<_, String>(2)?, "opening_cash": r.get::<_, f64>(3)?, "expected_cash": r.get::<_, f64>(4)?, "closing_cash": r.get::<_, Option<f64>>(5)?, "variance": r.get::<_, Option<f64>>(6)?, "status": r.get::<_, String>(7)?, "opened_at": r.get::<_, String>(8)?, "closed_at": r.get::<_, Option<String>>(9)?}))).map_err(|e| e.to_string())?.filter_map(|x| x.ok()).collect();
    Ok(json!({ "ok": true, "shifts": rows }))
}

pub fn open_shift(db_path: &Path, payload: &Value) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    let opening = num_val(payload, "opening_cash", 0.0).max(0.0);
    let ruuid = Uuid::new_v4().to_string();
    let shift_no = format!("SHF-{}", &ruuid[..6].to_uppercase());
    conn.execute(
        "INSERT INTO cash_shifts (shift_no, cashier_name, opening_cash, expected_cash, status, record_uuid) VALUES (?1,?2,?3,?3,'OPEN',?4)",
        params![shift_no, str_val(payload, "cashier_name", "Main Counter"), opening, ruuid],
    ).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "shift_no": shift_no }))
}

pub fn close_shift(db_path: &Path, payload: &Value) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    let closing = num_val(payload, "closing_cash", 0.0).max(0.0);
    let active: Option<(i64, String, f64)> = conn
        .query_row("SELECT id, shift_no, expected_cash FROM cash_shifts WHERE status='OPEN' ORDER BY id DESC LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional().map_err(|e| e.to_string())?;
    let Some((id, shift_no, expected)) = active else {
        return Err("No open register shift found.".into());
    };
    let variance = round2(closing - expected);
    conn.execute(
        "UPDATE cash_shifts SET closing_cash=?1, variance=?2, status='CLOSED', closed_at=datetime('now') WHERE id=?3",
        params![closing, variance, id],
    ).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "shift": { "id": id, "shift_no": shift_no, "expected_cash": expected, "closing_cash": closing, "variance": variance } }))
}

pub fn list_alterations(db_path: &Path) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    let mut st = conn.prepare("SELECT id, slip_no, customer_name, customer_phone, garment_ref, notes, due_date, status FROM alterations ORDER BY id DESC LIMIT 50").map_err(|e| e.to_string())?;
    let rows: Vec<Value> = st.query_map([], |r| Ok(json!({"id": r.get::<_, i64>(0)?, "slip_no": r.get::<_, String>(1)?, "customer_name": r.get::<_, String>(2)?, "customer_phone": r.get::<_, String>(3)?, "garment_ref": r.get::<_, String>(4)?, "notes": r.get::<_, String>(5)?, "due_date": r.get::<_, String>(6)?, "status": r.get::<_, String>(7)?}))).map_err(|e| e.to_string())?.filter_map(|x| x.ok()).collect();
    Ok(json!({ "ok": true, "alterations": rows }))
}

pub fn save_alteration(db_path: &Path, payload: &Value) -> Result<Value, String> {
    let conn = open_conn(db_path)?;
    let id = payload.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
    if id > 0 {
        conn.execute("UPDATE alterations SET status=?1 WHERE id=?2", params![str_val(payload, "status", "READY"), id]).map_err(|e| e.to_string())?;
        return Ok(json!({ "ok": true }));
    }
    let ruuid = Uuid::new_v4().to_string();
    let slip_no = format!("ALT-{}", &ruuid[..6].to_uppercase());
    conn.execute(
        "INSERT INTO alterations (slip_no, customer_name, customer_phone, garment_ref, notes, due_date, status, record_uuid) VALUES (?1,?2,?3,?4,?5,?6,'PENDING',?7)",
        params![slip_no, str_val(payload, "customer_name", ""), str_val(payload, "customer_phone", ""), str_val(payload, "garment_ref", ""), str_val(payload, "notes", ""), str_val(payload, "due_date", ""), ruuid],
    ).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "slip_no": slip_no }))
}

pub fn export_gstr1_file(db_path: &Path, export_dir: &Path) -> Result<String, String> {
    fs::create_dir_all(export_dir).map_err(|e| e.to_string())?;
    let conn = open_conn(db_path)?;
    let settings = read_settings(&conn)?;
    let mut st = conn.prepare("SELECT gst_rate, is_igst, SUM(taxable_value), SUM(cgst_amount), SUM(sgst_amount), SUM(igst_amount), SUM(line_total) FROM bill_items bi JOIN bills b ON b.id=bi.bill_id WHERE b.status!='CANCELLED' GROUP BY gst_rate, is_igst").map_err(|e| e.to_string())?;
    let b2cs: Vec<Value> = st.query_map([], |r| Ok(json!({"rate": r.get::<_, f64>(0)?, "type": if r.get::<_, i64>(1)? != 0 { "INTER" } else { "INTRA" }, "taxable_value": round2(r.get::<_, f64>(2)?), "cgst": round2(r.get::<_, f64>(3)?), "sgst": round2(r.get::<_, f64>(4)?), "igst": round2(r.get::<_, f64>(5)?), "total": round2(r.get::<_, f64>(6)?)}))).map_err(|e| e.to_string())?.filter_map(|x| x.ok()).collect();
    let out = json!({
        "gstin": settings["gstin"],
        "store_name": settings["store_name"],
        "generated_at": Utc::now().to_rfc3339(),
        "b2cs_rate_summary": b2cs
    });
    let file_path = export_dir.join(format!("GSTR1_{}.json", Utc::now().format("%Y%m%d_%H%M%S")));
    fs::write(&file_path, serde_json::to_string_pretty(&out).unwrap_or_default()).map_err(|e| e.to_string())?;
    Ok(file_path.to_string_lossy().to_string())
}

pub fn backup_database_atomic(db_path: &Path, backup_dir: &Path) -> Result<String, String> {
    fs::create_dir_all(backup_dir).map_err(|e| e.to_string())?;
    let dest: PathBuf = backup_dir.join(format!("agm_backup_{}.sqlite", Utc::now().format("%Y%m%d_%H%M%S")));
    let dest_sql = dest.to_string_lossy().replace('\'', "''");
    let conn = open_conn(db_path)?;
    conn.execute_batch(&format!("VACUUM INTO '{}';", dest_sql))
        .map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

pub fn export_csv_file(db_path: &Path, report_type: &str, export_dir: &Path) -> Result<String, String> {
    fs::create_dir_all(export_dir).map_err(|e| e.to_string())?;
    let conn = open_conn(db_path)?;
    let mut lines = Vec::new();
    match report_type {
        "garments" => {
            lines.push("SKU,Name,Category,Size,Colour,Cost,SellingPrice,StockQty,TotalSold".to_string());
            let mut st = conn.prepare("SELECT sku, name, category, size, colour, cost_price, selling_price, stock_qty, total_sold FROM garments ORDER BY id").map_err(|e| e.to_string())?;
            let rows = st.query_map([], |r| Ok(format!("\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",{},{},{},{}", r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, f64>(5)?, r.get::<_, f64>(6)?, r.get::<_, i64>(7)?, r.get::<_, i64>(8)?))).map_err(|e| e.to_string())?;
            for r in rows.flatten() { lines.push(r); }
        }
        "customers" => {
            lines.push("Code,Name,Phone,City,Visits,ItemsBought,TotalSpent".to_string());
            let mut st = conn.prepare("SELECT customer_code, full_name, phone, city, total_visits, total_items_bought, total_spent FROM customers ORDER BY total_spent DESC").map_err(|e| e.to_string())?;
            let rows = st.query_map([], |r| Ok(format!("\"{}\",\"{}\",\"{}\",\"{}\",{},{},{}", r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, i64>(4)?, r.get::<_, i64>(5)?, r.get::<_, f64>(6)?))).map_err(|e| e.to_string())?;
            for r in rows.flatten() { lines.push(r); }
        }
        _ => {
            lines.push("BillNo,Date,CustomerName,Phone,PaymentMode,Taxable,TotalGST,GrandTotal".to_string());
            let mut st = conn.prepare("SELECT bill_no, created_at, customer_name, customer_phone, payment_mode, taxable_amount, total_gst, grand_total FROM bills ORDER BY id DESC").map_err(|e| e.to_string())?;
            let rows = st.query_map([], |r| Ok(format!("\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",{},{},{}", r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, f64>(5)?, r.get::<_, f64>(6)?, r.get::<_, f64>(7)?))).map_err(|e| e.to_string())?;
            for r in rows.flatten() { lines.push(r); }
        }
    }
    let path = export_dir.join(format!("agm_{}_{}.csv", report_type, Utc::now().format("%Y%m%d_%H%M%S")));
    fs::write(&path, lines.join("\n")).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    #[test]
    fn checkout_return_and_atomic_backup_work_end_to_end() {
        let root = temp_dir().join(format!("agm_test_{}", Uuid::new_v4()));
        let db = root.join("showroom.sqlite");
        init_schema(&db).unwrap();

        save_garment(&db, &json!({
            "sku": "SHW-101",
            "name": "Royal Sherwani",
            "category": "Handwork Sherwani",
            "size": "40",
            "colour": "Ivory",
            "selling_price": 4000,
            "stock_qty": 5
        })).unwrap();

        let boot = get_bootstrap(&db).unwrap();
        let gid = boot["garments"][0]["id"].as_i64().unwrap();

        let bill_res = checkout_bill(&db, &json!({
            "customer_phone": "9876543210",
            "customer_name": "Kabir Verma",
            "tax_mode": "exclusive",
            "payment_mode": "Cash",
            "items": [{ "id": gid, "sku": "SHW-101", "name": "Royal Sherwani", "size": "40", "colour": "Ivory", "selling_price": 4000, "qty": 1 }]
        })).unwrap();
        assert_eq!(bill_res["bill"]["total_gst"].as_f64().unwrap(), 720.0);
        assert_eq!(bill_res["bill"]["grand_total"].as_f64().unwrap(), 4720.0);

        let ret = return_bill(&db, &json!({
            "bill_id": bill_res["bill"]["id"],
            "bill_no": bill_res["bill_no"],
            "refund_mode": "Credit Note",
            "items": [{ "garment_id": gid, "sku": "SHW-101", "garment_name": "Royal Sherwani", "qty": 1, "refund_amount": 4720.0 }]
        })).unwrap();
        assert!(ret["credit_note_code"].as_str().unwrap().starts_with("CN-"));

        let backup_path = backup_database_atomic(&db, &root.join("backups")).unwrap();
        assert!(Path::new(&backup_path).exists());
        let _ = fs::remove_dir_all(&root);
    }
}
