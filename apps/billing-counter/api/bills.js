const crypto = require("crypto");
const { requireAuth, parseBody } = require("../lib/auth");
const { queryRead, queryBothMerged, runDualWrite } = require("../lib/db");
const { computeLineGST } = require("../lib/gst");
const { dispatchBillNotifications } = require("../lib/notifications");

module.exports = async function handler(req, res) {
    const session = requireAuth(req, res, "any");
    if (!session) return;

    try {
        if (req.method === "GET") {
            const billNo = String(req.query.bill_no || "").trim();
            const id = Number(req.query.id || 0);

            if (billNo) {
                const bills = await queryBothMerged("SELECT * FROM bills WHERE bill_no = $1 LIMIT 1", [billNo], "bill_no");
                const bill = bills[0] || null;
                if (!bill) return res.status(200).json({ ok: true, bill: null, items: [] });
                const rawItems = await queryBothMerged(
                    `SELECT bi.*, CONCAT(bi.sku, ':', COALESCE(NULLIF(bi.record_uuid,''), CAST(bi.id AS TEXT))) AS dedupe_key
                     FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
                     WHERE b.bill_no = $1 ORDER BY bi.id ASC`,
                    [billNo],
                    "dedupe_key"
                );
                return res.status(200).json({ ok: true, bill, items: rawItems });
            }

            const [bRes, itemsRes] = await Promise.all([
                queryRead("SELECT * FROM bills WHERE id = $1", [id]),
                queryRead("SELECT * FROM bill_items WHERE bill_id = $1 ORDER BY id ASC", [id]),
            ]);
            return res.status(200).json({ ok: true, bill: bRes.rows[0] || null, items: itemsRes.rows });
        }

        if (req.method === "POST") {
            const data = parseBody(req);
            const action = String(data.action || "checkout");

            if (action === "return") {
                const origBillNo = String(data.original_bill_no || "").trim();
                const retLines = Array.isArray(data.items) ? data.items : [];
                if (!origBillNo || !retLines.length) {
                    return res.status(400).json({ ok: false, error: "Original Bill No and return items are required." });
                }
                const origBills = await queryBothMerged("SELECT * FROM bills WHERE bill_no = $1 LIMIT 1", [origBillNo], "bill_no");
                const origBill = origBills[0];
                if (!origBill) {
                    return res.status(404).json({ ok: false, error: `Bill ${origBillNo} not found.` });
                }

                const refundMode = String(data.refund_mode || "CREDIT_NOTE").toUpperCase();
                const reason = String(data.reason || "Customer Exchange / Return").trim();
                const rand = crypto.randomBytes(2).toString("hex").toUpperCase();
                const returnNo = `RET-${Date.now().toString(36).toUpperCase()}-${rand}`;
                const creditNoteNo = refundMode === "CREDIT_NOTE" ? `CN-${Date.now().toString(36).toUpperCase()}-${rand}` : "";
                const retUuid = crypto.randomUUID();

                let totalQty = 0, refundAmount = 0;
                const cleanItems = retLines.map((it) => {
                    const q = Math.max(1, Math.floor(Number(it.qty || 1)));
                    const up = Math.max(0, Number(it.unit_price || 0));
                    const lineTot = Number((q * up).toFixed(2));
                    totalQty += q;
                    refundAmount += lineTot;
                    return {
                        sku: String(it.sku || "").trim(),
                        garment_name: String(it.garment_name || it.name || "").trim(),
                        qty: q,
                        unit_price: up,
                        refund_line_total: lineTot,
                        restocked: it.restocked !== false,
                    };
                });
                refundAmount = Number(refundAmount.toFixed(2));

                const out = await runDualWrite(async (client) => {
                    const custRes = origBill.customer_phone
                        ? await client.query("SELECT id FROM customers WHERE phone = $1 LIMIT 1", [origBill.customer_phone])
                        : { rows: [] };
                    const custId = custRes.rows[0]?.id || null;
                    const billRes = await client.query("SELECT id FROM bills WHERE bill_no = $1 LIMIT 1", [origBillNo]);
                    const localBillId = billRes.rows[0]?.id || null;

                    const rIns = await client.query(
                        `INSERT INTO returns
                         (record_uuid, return_no, original_bill_id, original_bill_no, customer_id, customer_name, customer_phone,
                          total_qty, refund_amount, refund_mode, credit_note_no, reason)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
                        [
                            retUuid, returnNo, localBillId, origBillNo, custId,
                            origBill.customer_name || "", origBill.customer_phone || "",
                            totalQty, refundAmount, refundMode, creditNoteNo, reason,
                        ]
                    );
                    const retRow = rIns.rows[0];

                    for (const ri of cleanItems) {
                        let gId = null;
                        if (ri.restocked && ri.sku) {
                            const gUp = await client.query(
                                `UPDATE garments SET stock_qty = stock_qty + $1, total_sold = GREATEST(0, total_sold - $1), updated_at = CURRENT_TIMESTAMP
                                 WHERE sku = $2 RETURNING id, stock_qty`,
                                [ri.qty, ri.sku]
                            );
                            gId = gUp.rows[0]?.id || null;
                            if (gId) {
                                await client.query(
                                    `INSERT INTO stock_ledger (garment_id, sku, change_qty, balance_after, movement_type, reference_no, remarks)
                                     VALUES ($1,$2,$3,$4,'SALES_RETURN',$5,$6)`,
                                    [gId, ri.sku, ri.qty, gUp.rows[0].stock_qty, returnNo, reason]
                                );
                            }
                        }
                        await client.query(
                            `INSERT INTO return_items (return_id, garment_id, sku, garment_name, qty, unit_price, refund_line_total, restocked)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                            [retRow.id, gId, ri.sku, ri.garment_name, ri.qty, ri.unit_price, ri.refund_line_total, ri.restocked]
                        );
                    }

                    let creditNote = null;
                    if (creditNoteNo) {
                        const cnIns = await client.query(
                            `INSERT INTO credit_notes (record_uuid, credit_note_no, return_id, customer_id, customer_phone, customer_name, amount, balance_remaining, status)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'ACTIVE') RETURNING *`,
                            [crypto.randomUUID(), creditNoteNo, retRow.id, custId, origBill.customer_phone || "", origBill.customer_name || "", refundAmount]
                        );
                        creditNote = cnIns.rows[0];
                    }

                    await client.query(
                        `INSERT INTO audit_logs (actor_role, action_type, entity_type, entity_ref, summary)
                         VALUES ($1,'SALES_RETURN','BILL',$2,$3)`,
                        [session.role, origBillNo, `${returnNo}: Rs.${refundAmount} (${refundMode})`]
                    );

                    return { ret: retRow, creditNote };
                });

                return res.status(200).json({ ok: true, ...out.result, writtenTo: out.writtenTo });
            }

            // Standard Checkout
            const cartLines = Array.isArray(data.items) ? data.items : [];
            if (!cartLines.length) {
                return res.status(400).json({ ok: false, error: "Cannot generate an empty bill." });
            }

            const setRes = await queryRead("SELECT * FROM store_settings WHERE id = 1");
            const settings = setRes.rows[0] || {};
            const taxMode = data.tax_mode || settings.tax_mode || "exclusive";
            const customerPhone = String(data.customer_phone || "").trim();
            const customerName = String(data.customer_name || (customerPhone ? `Customer ${customerPhone}` : "Walk-in Customer")).trim();
            const customerCity = String(data.customer_city || "").trim();
            const customerGstin = String(data.customer_gstin || "").trim();
            const paymentMode = String(data.payment_mode || "Cash").trim();
            const billDiscount = Math.max(0, Number(data.bill_discount || 0));
            const isIgst = Boolean(data.is_igst);
            const creditNoteCode = String(data.credit_note_no || "").trim().toUpperCase();

            // First compute gross line totals before allocating optional bill-level discount proportionally
            const rawLines = [];
            let grossLinesTotal = 0;
            for (const line of cartLines) {
                const qty = Math.max(1, Math.floor(Number(line.qty || 1)));
                const unitPrice = Math.max(0, Number(line.selling_price || 0));
                const lineDisc = Math.max(0, Number(line.line_discount || 0));
                const grossLine = Math.max(0, unitPrice * qty - lineDisc);
                grossLinesTotal += grossLine;
                rawLines.push({
                    sku: String(line.sku || "").trim(),
                    barcode: String(line.barcode || "").trim(),
                    garment_name: String(line.name || "").trim(),
                    category: String(line.category || "").trim(),
                    size: String(line.size || "").trim(),
                    colour: String(line.colour || "").trim(),
                    hsn_code: String(line.hsn_code || "6203").trim(),
                    qty,
                    unit_price: unitPrice,
                    line_discount: lineDisc,
                    gross_line: grossLine,
                });
            }

            let subtotal = 0, totalLineDisc = 0, taxableSum = 0, cgstSum = 0, sgstSum = 0, igstSum = 0, grandTotal = 0, totalQty = 0;
            let remainingBillDisc = Math.min(billDiscount, grossLinesTotal);
            const processedLines = [];
            const customOpts = {
                customGstEnabled: Boolean(data.custom_gst_enabled),
                customCgstRate: data.custom_cgst_rate,
                customSgstRate: data.custom_sgst_rate,
                isIgst,
            };

            for (let i = 0; i < rawLines.length; i++) {
                const rl = rawLines[i];
                let allocatedBillDisc = 0;
                if (billDiscount > 0 && grossLinesTotal > 0) {
                    allocatedBillDisc = i === rawLines.length - 1
                        ? Number(remainingBillDisc.toFixed(2))
                        : Number(((rl.gross_line / grossLinesTotal) * billDiscount).toFixed(2));
                    remainingBillDisc = Math.max(0, Number((remainingBillDisc - allocatedBillDisc).toFixed(2)));
                }
                const effectiveDisc = Number((rl.line_discount + allocatedBillDisc).toFixed(2));
                const tax = computeLineGST(rl.unit_price, rl.qty, effectiveDisc, taxMode, customOpts);

                subtotal += Number((rl.unit_price * rl.qty).toFixed(2));
                totalLineDisc += rl.line_discount;
                taxableSum += tax.taxable_value;
                cgstSum += tax.cgst_amount;
                sgstSum += tax.sgst_amount;
                igstSum += tax.igst_amount;
                grandTotal += tax.line_total;
                totalQty += rl.qty;

                processedLines.push({
                    record_uuid: crypto.randomUUID(),
                    sku: rl.sku,
                    barcode: rl.barcode,
                    garment_name: rl.garment_name,
                    category: rl.category,
                    size: rl.size,
                    colour: rl.colour,
                    hsn_code: rl.hsn_code,
                    qty: rl.qty,
                    unit_price: rl.unit_price,
                    line_discount: effectiveDisc,
                    ...tax,
                });
            }

            subtotal = Number(subtotal.toFixed(2));
            taxableSum = Number(taxableSum.toFixed(2));
            cgstSum = Number(cgstSum.toFixed(2));
            sgstSum = Number(sgstSum.toFixed(2));
            igstSum = Number(igstSum.toFixed(2));
            grandTotal = Number(grandTotal.toFixed(2));
            const totalDiscount = Number((totalLineDisc + Math.min(billDiscount, grossLinesTotal)).toFixed(2));
            const totalGst = Number((cgstSum + sgstSum + igstSum).toFixed(2));

            let creditApplied = 0;
            if (creditNoteCode) {
                const cnRes = await queryRead("SELECT * FROM credit_notes WHERE credit_note_no = $1 AND status = 'ACTIVE' LIMIT 1", [creditNoteCode]);
                if (cnRes.rows[0]) {
                    creditApplied = Math.min(grandTotal, Number(cnRes.rows[0].balance_remaining || 0));
                }
            }
            const netPayableAfterCredit = Number(Math.max(0, grandTotal - creditApplied).toFixed(2));
            const amountReceived = data.amount_received !== "" && data.amount_received !== undefined ? Number(data.amount_received) : netPayableAfterCredit;
            const changeReturned = Math.max(0, Number((amountReceived - netPayableAfterCredit).toFixed(2)));
            const cashPaid = Number(data.cash_paid || (paymentMode === "Cash" ? netPayableAfterCredit : 0));
            const upiPaid = Number(data.upi_paid || (paymentMode === "UPI / QR" ? netPayableAfterCredit : 0));
            const cardPaid = Number(data.card_paid || (paymentMode === "Card" ? netPayableAfterCredit : 0));

            const randSuffix = crypto.randomBytes(2).toString("hex").toUpperCase();
            const newCustCode = `CUST-${Date.now().toString(36).toUpperCase()}-${randSuffix}`;
            const billUuid = crypto.randomUUID();
            const custUuid = crypto.randomUUID();

            let out = null;
            let billNo = "";
            for (let attempt = 0; attempt < 3; attempt++) {
                const seqRes = await queryRead(
                    "SELECT GREATEST(nextval('bill_no_seq'), COALESCE((SELECT MAX(id) FROM bills), 0) + 1)::bigint AS seq_no"
                );
                const seqNo = Number(seqRes.rows[0]?.seq_no || Date.now());
                billNo = `${settings.bill_prefix || "INV-"}${String(seqNo).padStart(5, "0")}`;

                try {
                    out = await runDualWrite(async (client) => {
                        let customerId = null;
                        let customerCode = "";

                        if (customerPhone) {
                            const cUp = await client.query(
                                `INSERT INTO customers (record_uuid, customer_code, phone, full_name, city, gstin, total_visits, total_items_bought, total_spent, last_purchase_at)
                                 VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,CURRENT_TIMESTAMP)
                                 ON CONFLICT (phone) DO UPDATE SET
                                   full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), customers.full_name),
                                   city = COALESCE(NULLIF(EXCLUDED.city, ''), customers.city),
                                   gstin = COALESCE(NULLIF(EXCLUDED.gstin, ''), customers.gstin),
                                   total_visits = customers.total_visits + 1,
                                   total_items_bought = customers.total_items_bought + EXCLUDED.total_items_bought,
                                   total_spent = customers.total_spent + EXCLUDED.total_spent,
                                   last_purchase_at = CURRENT_TIMESTAMP,
                                   updated_at = CURRENT_TIMESTAMP
                                 RETURNING id, customer_code`,
                                [custUuid, newCustCode, customerPhone, customerName, customerCity, customerGstin, totalQty, grandTotal]
                            );
                            customerId = cUp.rows[0].id;
                            customerCode = cUp.rows[0].customer_code;
                        }

                        const openShift = await client.query("SELECT id FROM cash_shifts WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1");
                        const shiftId = openShift.rows[0]?.id || null;

                        const billIns = await client.query(
                            `INSERT INTO bills
                             (record_uuid, bill_no, customer_id, customer_code, customer_name, customer_phone, customer_city, customer_gstin,
                              payment_mode, tax_mode, is_igst, total_qty, subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount,
                              total_gst, grand_total, amount_received, change_returned, cash_paid, upi_paid, card_paid, shift_id, credit_note_used, credit_note_amount)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
                             RETURNING *`,
                            [
                                billUuid, billNo, customerId, customerCode, customerName, customerPhone, customerCity, customerGstin,
                                paymentMode, taxMode, isIgst, totalQty, subtotal, totalDiscount, taxableSum, cgstSum, sgstSum, igstSum,
                                totalGst, grandTotal, amountReceived, changeReturned, cashPaid, upiPaid, cardPaid, shiftId, creditNoteCode, creditApplied,
                            ]
                        );
                        const billRecord = billIns.rows[0];

                        if (creditNoteCode && creditApplied > 0) {
                            await client.query(
                                `UPDATE credit_notes
                                 SET balance_remaining = GREATEST(0, balance_remaining - $1),
                                     status = CASE WHEN balance_remaining - $1 <= 0.01 THEN 'REDEEMED' ELSE 'ACTIVE' END,
                                     redeemed_bill_no = $2,
                                     updated_at = CURRENT_TIMESTAMP
                                 WHERE credit_note_no = $3`,
                                [creditApplied, billNo, creditNoteCode]
                            );
                        }

                        if (shiftId) {
                            await client.query(
                                `UPDATE cash_shifts
                                 SET cash_sales = cash_sales + $1, upi_sales = upi_sales + $2, card_sales = card_sales + $3,
                                     expected_cash = expected_cash + $1
                                 WHERE id = $4`,
                                [cashPaid, upiPaid, cardPaid, shiftId]
                            );
                        }

                        for (const pl of processedLines) {
                            const gUp = await client.query(
                                `UPDATE garments SET stock_qty = GREATEST(0, stock_qty - $1), total_sold = total_sold + $1, updated_at = CURRENT_TIMESTAMP
                                 WHERE sku = $2 RETURNING id, stock_qty`,
                                [pl.qty, pl.sku]
                            );
                            const gId = gUp.rows[0]?.id || null;
                            await client.query(
                                `INSERT INTO bill_items
                                 (record_uuid, bill_id, customer_id, garment_id, sku, barcode, garment_name, category, size, colour, hsn_code,
                                  qty, unit_price, line_discount, taxable_value, gst_rate, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, line_total)
                                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
                                [
                                    pl.record_uuid, billRecord.id, customerId, gId, pl.sku, pl.barcode, pl.garment_name, pl.category,
                                    pl.size, pl.colour, pl.hsn_code, pl.qty, pl.unit_price, pl.line_discount, pl.taxable_value,
                                    pl.gst_rate, pl.cgst_rate, pl.cgst_amount, pl.sgst_rate, pl.sgst_amount, pl.igst_rate, pl.igst_amount, pl.line_total,
                                ]
                            );
                            if (gId) {
                                await client.query(
                                    `INSERT INTO stock_ledger (garment_id, sku, change_qty, balance_after, movement_type, reference_no, remarks)
                                     VALUES ($1,$2,$3,$4,'BILL_SALE',$5,$6)`,
                                    [gId, pl.sku, -pl.qty, gUp.rows[0].stock_qty, billNo, `Sold to ${customerName}`]
                                );
                            }
                        }
                        return billRecord;
                    });
                    break;
                } catch (txErr) {
                    if (txErr && txErr.code === "23505" && String(txErr.detail || txErr.constraint || "").includes("bill_no") && attempt < 2) {
                        continue;
                    }
                    throw txErr;
                }
            }

            const notif = await dispatchBillNotifications(out.result, processedLines).catch(() => ({ results: [] }));
            return res.status(200).json({
                ok: true,
                bill: out.result,
                items: processedLines,
                writtenTo: out.writtenTo,
                mirrored: out.mirrored,
                notifications: notif,
            });
        }

        return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};
