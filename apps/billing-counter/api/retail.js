const crypto = require("crypto");
const { requireAuth, parseBody } = require("../lib/auth");
const { queryRead, queryBothMerged, runDualWrite } = require("../lib/db");

/**
 * Unified Retail Operations API (/api/retail):
 *   - Suppliers & Purchase GRN Stock-In
 *   - Sales Returns & Store Credit Notes
 *   - Cashier Shifts & Day-End Z-Report
 *   - Tailoring / Alteration Slips
 *   - GSTR-1 Outward Supplies Summary (5% / 18% / B2B / HSN)
 */
module.exports = async function handler(req, res) {
    const session = requireAuth(req, res, "any");
    if (!session) return;

    try {
        if (req.method === "GET") {
            const action = String(req.query.action || "summary");

            if (action === "suppliers") {
                const [sups, purchases] = await Promise.all([
                    queryRead("SELECT * FROM suppliers ORDER BY name ASC"),
                    queryRead("SELECT * FROM purchase_bills ORDER BY created_at DESC LIMIT 60"),
                ]);
                return res.status(200).json({ ok: true, suppliers: sups.rows, purchases: purchases.rows });
            }

            if (action === "returns") {
                const [rets, notes] = await Promise.all([
                    queryRead("SELECT * FROM returns ORDER BY created_at DESC LIMIT 60"),
                    queryRead("SELECT * FROM credit_notes ORDER BY created_at DESC LIMIT 60"),
                ]);
                return res.status(200).json({ ok: true, returns: rets.rows, credit_notes: notes.rows });
            }

            if (action === "checkCreditNote") {
                const code = String(req.query.code || "").trim().toUpperCase();
                if (!code) return res.status(200).json({ ok: true, credit_note: null });
                const r = await queryRead("SELECT * FROM credit_notes WHERE credit_note_no = $1 LIMIT 1", [code]);
                return res.status(200).json({ ok: true, credit_note: r.rows[0] || null });
            }

            if (action === "shifts") {
                const r = await queryRead("SELECT * FROM cash_shifts ORDER BY opened_at DESC LIMIT 30");
                return res.status(200).json({ ok: true, shifts: r.rows, active_shift: r.rows.find((s) => s.status === "OPEN") || null });
            }

            if (action === "alterations") {
                const r = await queryRead("SELECT * FROM alterations ORDER BY created_at DESC LIMIT 100");
                return res.status(200).json({ ok: true, alterations: r.rows });
            }

            if (action === "gstr1") {
                const from = String(req.query.from || "").trim();
                const to = String(req.query.to || "").trim();
                let where = "";
                const params = [];
                if (from && to) {
                    where = "WHERE DATE(b.created_at) >= $1 AND DATE(b.created_at) <= $2";
                    params.push(from, to);
                }
                const [hsnRes, slabRes, b2bRes] = await Promise.all([
                    queryRead(
                        `SELECT bi.hsn_code, bi.gst_rate, SUM(bi.qty)::int AS total_qty,
                                SUM(bi.taxable_value)::numeric(14,2) AS taxable_value,
                                SUM(bi.cgst_amount)::numeric(14,2) AS cgst_amount,
                                SUM(bi.sgst_amount)::numeric(14,2) AS sgst_amount,
                                SUM(bi.igst_amount)::numeric(14,2) AS igst_amount,
                                SUM(bi.line_total)::numeric(14,2) AS total_value
                         FROM bill_items bi
                         JOIN bills b ON b.id = bi.bill_id
                         ${where}
                         GROUP BY bi.hsn_code, bi.gst_rate
                         ORDER BY bi.hsn_code, bi.gst_rate`,
                        params
                    ),
                    queryRead(
                        `SELECT bi.gst_rate, COUNT(DISTINCT bi.bill_id)::int AS invoice_count,
                                SUM(bi.taxable_value)::numeric(14,2) AS taxable_value,
                                SUM(bi.cgst_amount + bi.sgst_amount + bi.igst_amount)::numeric(14,2) AS total_tax,
                                SUM(bi.line_total)::numeric(14,2) AS invoice_value
                         FROM bill_items bi
                         JOIN bills b ON b.id = bi.bill_id
                         ${where}
                         GROUP BY bi.gst_rate
                         ORDER BY bi.gst_rate`,
                        params
                    ),
                    queryBothMerged(
                        `SELECT bill_no, created_at, customer_name, customer_gstin, taxable_amount, cgst_amount, sgst_amount, igst_amount, grand_total
                         FROM bills WHERE COALESCE(customer_gstin, '') <> '' ORDER BY created_at DESC LIMIT 200`,
                        [],
                        "bill_no"
                    ),
                ]);

                const payload = {
                    ok: true,
                    generated_at: new Date().toISOString(),
                    period: { from: from || "ALL", to: to || "ALL" },
                    b2cs_rate_summary: slabRes.rows,
                    hsn_summary: hsnRes.rows,
                    b2b_invoices: b2bRes,
                };
                if (req.query.download === "1") {
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.setHeader("Content-Disposition", `attachment; filename="GSTR1_Showroom_Summary.json"`);
                }
                return res.status(200).json(payload);
            }

            // Combined overview
            const [sups, shifts, alts, rets] = await Promise.all([
                queryRead("SELECT COUNT(*)::int AS c FROM suppliers"),
                queryRead("SELECT * FROM cash_shifts WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1"),
                queryRead("SELECT COUNT(*)::int AS c FROM alterations WHERE status = 'PENDING'"),
                queryRead("SELECT COUNT(*)::int AS c FROM returns"),
            ]);
            return res.status(200).json({
                ok: true,
                suppliers_count: sups.rows[0]?.c || 0,
                active_shift: shifts.rows[0] || null,
                pending_alterations: alts.rows[0]?.c || 0,
                returns_count: rets.rows[0]?.c || 0,
            });
        }

        if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
        const body = parseBody(req);
        const action = String(body.action || "");

        if (action === "saveSupplier") {
            const name = String(body.name || "").trim();
            if (!name) return res.status(400).json({ ok: false, error: "Supplier Name is required." });
            const code = String(body.supplier_code || `SUP-${Date.now().toString(36).toUpperCase()}`);
            const out = await runDualWrite(async (client) => {
                const r = await client.query(
                    `INSERT INTO suppliers (record_uuid, supplier_code, name, phone, gstin, city, address)
                     VALUES ($1,$2,$3,$4,$5,$6,$7)
                     ON CONFLICT (supplier_code) DO UPDATE
                     SET name = EXCLUDED.name, phone = EXCLUDED.phone, gstin = EXCLUDED.gstin,
                         city = EXCLUDED.city, address = EXCLUDED.address, updated_at = CURRENT_TIMESTAMP
                     RETURNING *`,
                    [crypto.randomUUID(), code, name, body.phone || "", body.gstin || "", body.city || "", body.address || ""]
                );
                return r.rows[0];
            });
            return res.status(200).json({ ok: true, supplier: out.result });
        }

        if (action === "recordPurchase") {
            const supplierName = String(body.supplier_name || "Wholesaler").trim();
            const sku = String(body.sku || "").trim().toUpperCase();
            const qty = Math.max(1, Math.floor(Number(body.qty || 1)));
            const costPrice = Math.max(0, Number(body.cost_price || 0));
            const gstPct = Math.max(0, Number(body.gst_pct || 5));
            if (!sku) return res.status(400).json({ ok: false, error: "Target SKU is required for GRN stock-in." });

            const taxable = Number((qty * costPrice).toFixed(2));
            const gstAmt = Number((taxable * (gstPct / 100)).toFixed(2));
            const grandTot = Number((taxable + gstAmt).toFixed(2));
            const paidAmt = body.paid_amount !== undefined ? Number(body.paid_amount) : grandTot;
            const purNo = `PUR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

            const out = await runDualWrite(async (client) => {
                const supRes = await client.query("SELECT id FROM suppliers WHERE name = $1 LIMIT 1", [supplierName]);
                const supId = supRes.rows[0]?.id || null;
                if (supId) {
                    await client.query(
                        "UPDATE suppliers SET total_purchased = total_purchased + $1, total_paid = total_paid + $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
                        [grandTot, paidAmt, supId]
                    );
                }
                const gUp = await client.query(
                    `UPDATE garments SET stock_qty = stock_qty + $1, cost_price = CASE WHEN $2 > 0 THEN $2 ELSE cost_price END, updated_at = CURRENT_TIMESTAMP
                     WHERE sku = $3 RETURNING id, name, stock_qty`,
                    [qty, costPrice, sku]
                );
                if (gUp.rowCount === 0) throw new Error(`SKU "${sku}" not found in inventory. Create the garment SKU first.`);
                const g = gUp.rows[0];
                await client.query(
                    `INSERT INTO stock_ledger (garment_id, sku, change_qty, balance_after, movement_type, reference_no, remarks)
                     VALUES ($1,$2,$3,$4,'PURCHASE_GRN',$5,$6)`,
                    [g.id, sku, qty, g.stock_qty, purNo, `Purchased from ${supplierName}`]
                );
                const pIns = await client.query(
                    `INSERT INTO purchase_bills (record_uuid, purchase_no, supplier_id, supplier_name, invoice_no, total_qty, taxable_amount, gst_amount, grand_total, paid_amount, payment_status, items_json, notes)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
                    [
                        crypto.randomUUID(), purNo, supId, supplierName, body.invoice_no || "",
                        qty, taxable, gstAmt, grandTot, paidAmt,
                        paidAmt >= grandTot ? "PAID" : "PARTIAL",
                        JSON.stringify([{ sku, garment_name: g.name, qty, cost_price: costPrice }]),
                        body.notes || "",
                    ]
                );
                return pIns.rows[0];
            });
            return res.status(200).json({ ok: true, purchase: out.result });
        }

        if (action === "openShift") {
            const cashier = String(body.cashier_name || "Counter Staff").trim();
            const openingCash = Math.max(0, Number(body.opening_cash || 0));
            const shiftNo = `SHF-${Date.now().toString(36).toUpperCase()}`;
            const out = await runDualWrite(async (client) => {
                const existing = await client.query("SELECT * FROM cash_shifts WHERE status = 'OPEN' LIMIT 1");
                if (existing.rowCount > 0) return existing.rows[0];
                const ins = await client.query(
                    `INSERT INTO cash_shifts (record_uuid, shift_no, cashier_name, opening_cash, expected_cash, status)
                     VALUES ($1,$2,$3,$4,$4,'OPEN') RETURNING *`,
                    [crypto.randomUUID(), shiftNo, cashier, openingCash]
                );
                return ins.rows[0];
            });
            return res.status(200).json({ ok: true, shift: out.result });
        }

        if (action === "closeShift") {
            const counted = Math.max(0, Number(body.counted_cash || 0));
            const payouts = Math.max(0, Number(body.cash_payouts || 0));
            const notes = String(body.notes || "").trim();
            const out = await runDualWrite(async (client) => {
                const openRes = await client.query("SELECT * FROM cash_shifts WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1");
                if (openRes.rowCount === 0) throw new Error("No OPEN cash shift found.");
                const sh = openRes.rows[0];
                const expected = Number((Number(sh.opening_cash) + Number(sh.cash_sales) - Number(sh.cash_refunds) - payouts).toFixed(2));
                const variance = Number((counted - expected).toFixed(2));
                const up = await client.query(
                    `UPDATE cash_shifts
                     SET cash_payouts=$1, expected_cash=$2, counted_cash=$3, variance_amount=$4, notes=$5, status='CLOSED', closed_at=CURRENT_TIMESTAMP
                     WHERE id=$6 RETURNING *`,
                    [payouts, expected, counted, variance, notes, sh.id]
                );
                return up.rows[0];
            });
            return res.status(200).json({ ok: true, shift: out.result });
        }

        if (action === "saveAlteration") {
            const id = body.id ? Number(body.id) : null;
            const out = await runDualWrite(async (client) => {
                if (id) {
                    const up = await client.query(
                        `UPDATE alterations SET status=$1, measurements=$2, tailor_notes=$3, delivery_date=$4, updated_at=CURRENT_TIMESTAMP
                         WHERE id=$5 RETURNING *`,
                        [body.status || "READY", body.measurements || "", body.tailor_notes || "", body.delivery_date || "", id]
                    );
                    if (up.rowCount > 0) return up.rows[0];
                }
                const slipNo = `ALT-${Date.now().toString(36).toUpperCase()}`;
                const ins = await client.query(
                    `INSERT INTO alterations (record_uuid, slip_no, bill_no, customer_name, customer_phone, garment_name, measurements, tailor_notes, delivery_date, status)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
                    [
                        crypto.randomUUID(), slipNo, body.bill_no || "", body.customer_name || "Customer",
                        body.customer_phone || "", body.garment_name || "Custom Fitting",
                        body.measurements || "", body.tailor_notes || "", body.delivery_date || "", body.status || "PENDING",
                    ]
                );
                return ins.rows[0];
            });
            return res.status(200).json({ ok: true, alteration: out.result });
        }

        return res.status(400).json({ ok: false, error: "Unknown retail action" });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};
