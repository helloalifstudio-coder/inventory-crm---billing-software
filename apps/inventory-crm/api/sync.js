const { requireAuth, parseBody, safeEqual } = require("../lib/auth");
const { queryRead, runDualWrite } = require("../lib/db");

/**
 * Bi-Directional Offline Native Desktop <-> Vercel Dual-DB Sync API (/api/sync)
 * Authenticates via OWNER/STAFF session OR header `x-sync-secret` matching SESSION_SECRET / SYNC_SECRET.
 */
function checkSyncAuth(req, res) {
    const hdrSecret = String(req.headers["x-sync-secret"] || "").trim();
    const expectedSecret = String(process.env.SYNC_SECRET || process.env.SESSION_SECRET || "").trim();
    if (hdrSecret && expectedSecret && safeEqual(hdrSecret, expectedSecret)) {
        return { role: "sync_agent" };
    }
    return requireAuth(req, res, "any");
}

module.exports = async function handler(req, res) {
    const session = checkSyncAuth(req, res);
    if (!session) return;

    try {
        if (req.method === "GET") {
            const since = String(req.query.since || "1970-01-01T00:00:00.000Z");
            const [garments, customers, bills, settings] = await Promise.all([
                queryRead("SELECT * FROM garments WHERE updated_at >= $1::timestamp ORDER BY updated_at ASC LIMIT 500", [since]),
                queryRead("SELECT * FROM customers WHERE updated_at >= $1::timestamp ORDER BY updated_at ASC LIMIT 500", [since]),
                queryRead("SELECT * FROM bills WHERE created_at >= $1::timestamp ORDER BY created_at ASC LIMIT 300", [since]),
                queryRead("SELECT * FROM store_settings WHERE id = 1"),
            ]);
            return res.status(200).json({
                ok: true,
                server_time: new Date().toISOString(),
                deltas: {
                    garments: garments.rows,
                    customers: customers.rows,
                    bills: bills.rows,
                    store_settings: settings.rows[0] || null,
                },
            });
        }

        if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
        const body = parseBody(req);
        const ops = Array.isArray(body.outbox) ? body.outbox : [];
        const deviceId = String(body.device_id || "windows-native").slice(0, 80);

        const appliedIds = [];
        if (ops.length > 0) {
            await runDualWrite(async (client) => {
                for (const op of ops) {
                    const p = typeof op.payload === "string" ? JSON.parse(op.payload) : (op.payload || {});
                    if (op.entity_type === "garment" && p.sku) {
                        await client.query(
                            `INSERT INTO garments (record_uuid, sku, barcode, name, category, sub_category, size, colour, fabric_type, rack_location, hsn_code, cost_price, mrp_price, selling_price, stock_qty, min_stock_alert, total_sold, active)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
                             ON CONFLICT (sku) DO UPDATE SET
                               barcode=EXCLUDED.barcode, name=EXCLUDED.name, category=EXCLUDED.category, size=EXCLUDED.size,
                               colour=EXCLUDED.colour, cost_price=EXCLUDED.cost_price, selling_price=EXCLUDED.selling_price,
                               stock_qty=EXCLUDED.stock_qty, total_sold=EXCLUDED.total_sold, active=EXCLUDED.active, updated_at=CURRENT_TIMESTAMP`,
                            [
                                p.record_uuid || "", p.sku, p.barcode || p.sku, p.name || p.sku, p.category || "Handwork Sherwani",
                                p.sub_category || "Men's Wear", p.size || "40", p.colour || "Ivory", p.fabric_type || "",
                                p.rack_location || "RACK-A1", p.hsn_code || "6203", Number(p.cost_price || 0),
                                Number(p.mrp_price || p.selling_price || 0), Number(p.selling_price || 0),
                                Number(p.stock_qty || 0), Number(p.min_stock_alert || 3), Number(p.total_sold || 0), p.active !== false,
                            ]
                        );
                    } else if (op.entity_type === "customer" && p.phone) {
                        await client.query(
                            `INSERT INTO customers (record_uuid, customer_code, phone, full_name, city, address, email, gstin, notes, total_visits, total_items_bought, total_spent)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                             ON CONFLICT (phone) DO UPDATE SET
                               full_name=EXCLUDED.full_name, city=COALESCE(NULLIF(EXCLUDED.city,''), customers.city),
                               total_visits=GREATEST(customers.total_visits, EXCLUDED.total_visits),
                               total_items_bought=GREATEST(customers.total_items_bought, EXCLUDED.total_items_bought),
                               total_spent=GREATEST(customers.total_spent, EXCLUDED.total_spent),
                               updated_at=CURRENT_TIMESTAMP`,
                            [
                                p.record_uuid || "", p.customer_code || `CUST-${Date.now().toString(36).toUpperCase()}`, p.phone,
                                p.full_name || "Customer", p.city || "", p.address || "", p.email || "", p.gstin || "", p.notes || "",
                                Number(p.total_visits || 0), Number(p.total_items_bought || 0), Number(p.total_spent || 0),
                            ]
                        );
                    } else if (op.entity_type === "bill" && p.bill_no) {
                        const cLookup = p.customer_phone
                            ? await client.query("SELECT id FROM customers WHERE phone = $1 LIMIT 1", [p.customer_phone])
                            : { rows: [] };
                        const custId = cLookup.rows[0]?.id || null;
                        const bIns = await client.query(
                            `INSERT INTO bills (record_uuid, bill_no, customer_id, customer_code, customer_name, customer_phone, customer_city, customer_gstin,
                              payment_mode, tax_mode, is_igst, total_qty, subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount,
                              total_gst, grand_total, amount_received, change_returned, cash_paid, upi_paid, card_paid, created_at)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,COALESCE($26::timestamp, CURRENT_TIMESTAMP))
                             ON CONFLICT (bill_no) DO NOTHING RETURNING id`,
                            [
                                p.record_uuid || "", p.bill_no, custId, p.customer_code || "", p.customer_name || "Walk-in Customer",
                                p.customer_phone || "", p.customer_city || "", p.customer_gstin || "", p.payment_mode || "Cash",
                                p.tax_mode || "exclusive", Boolean(p.is_igst), Number(p.total_qty || 0), Number(p.subtotal || 0),
                                Number(p.discount_amount || 0), Number(p.taxable_amount || 0), Number(p.cgst_amount || 0),
                                Number(p.sgst_amount || 0), Number(p.igst_amount || 0), Number(p.total_gst || 0), Number(p.grand_total || 0),
                                Number(p.amount_received || 0), Number(p.change_returned || 0), Number(p.cash_paid || 0),
                                Number(p.upi_paid || 0), Number(p.card_paid || 0), p.created_at || null,
                            ]
                        );
                        if (bIns.rowCount > 0 && Array.isArray(p.items)) {
                            const bid = bIns.rows[0].id;
                            for (const it of p.items) {
                                await client.query(
                                    `INSERT INTO bill_items (record_uuid, bill_id, customer_id, sku, barcode, garment_name, category, size, colour, hsn_code, qty, unit_price, line_discount, taxable_value, gst_rate, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, line_total)
                                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
                                    [
                                        it.record_uuid || "", bid, custId, it.sku, it.barcode || "", it.garment_name || it.name || it.sku,
                                        it.category || "", it.size || "", it.colour || "", it.hsn_code || "6203", Number(it.qty || 1),
                                        Number(it.unit_price || 0), Number(it.line_discount || 0), Number(it.taxable_value || 0),
                                        Number(it.gst_rate || 5), Number(it.cgst_rate || 0), Number(it.cgst_amount || 0),
                                        Number(it.sgst_rate || 0), Number(it.sgst_amount || 0), Number(it.igst_rate || 0),
                                        Number(it.igst_amount || 0), Number(it.line_total || 0),
                                    ]
                                );
                            }
                        }
                    }
                    appliedIds.push(op.id);
                }

                await client.query(
                    `INSERT INTO sync_cursors (device_id, last_pushed_at, device_name, updated_at)
                     VALUES ($1, CURRENT_TIMESTAMP, $2, CURRENT_TIMESTAMP)
                     ON CONFLICT (device_id) DO UPDATE SET last_pushed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
                    [deviceId, String(body.device_name || deviceId)]
                );
            });
        }

        return res.status(200).json({ ok: true, ack_ids: appliedIds, synced_at: new Date().toISOString() });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};
