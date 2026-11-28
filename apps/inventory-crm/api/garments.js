const crypto = require("crypto");
const { requireAuth, parseBody } = require("../lib/auth");
const { runDualWrite } = require("../lib/db");

module.exports = async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    const session = requireAuth(req, res, "any");
    if (!session) return;

    const body = parseBody(req);
    const action = body.action || "save";

    try {
        if (action === "save") {
            const gId = body.id ? Number(body.id) : null;
            const sku = String(body.sku || "").trim().toUpperCase();
            const barcode = String(body.barcode || "").trim() || sku;
            const name = String(body.name || "").trim();
            if (!sku || !name) return res.status(400).json({ ok: false, error: "SKU and Garment Name are required." });

            const category = String(body.category || "Handwork Sherwani").trim();
            const subCategory = String(body.sub_category || "Men's Wear").trim();
            const size = String(body.size || "40").trim();
            const colour = String(body.colour || "Ivory").trim();
            const fabricType = String(body.fabric_type || "").trim();
            const rackLocation = String(body.rack_location || "RACK-A1").trim();
            const hsnCode = String(body.hsn_code || "6203").trim();
            const costPrice = Math.max(0, Number(body.cost_price || 0));
            const sellingPrice = Math.max(0, Number(body.selling_price || 0));
            const mrpPrice = Math.max(0, Number(body.mrp_price || sellingPrice));
            const stockQty = Math.max(0, Math.floor(Number(body.stock_qty || 0)));
            const minAlert = Math.max(0, Math.floor(Number(body.min_stock_alert || 3)));
            const recUuid = String(body.record_uuid || crypto.randomUUID());

            const out = await runDualWrite(async (client) => {
                const existing = gId
                    ? await client.query("SELECT id, stock_qty FROM garments WHERE id = $1 LIMIT 1", [gId])
                    : await client.query("SELECT id, stock_qty FROM garments WHERE sku = $1 LIMIT 1", [sku]);
                if (existing.rowCount > 0) {
                    const id = existing.rows[0].id;
                    const oldQty = existing.rows[0].stock_qty;
                    await client.query(
                        `UPDATE garments
                         SET sku=$1, barcode=$2, name=$3, category=$4, sub_category=$5, size=$6, colour=$7,
                             fabric_type=$8, rack_location=$9, hsn_code=$10, cost_price=$11, mrp_price=$12,
                             selling_price=$13, stock_qty=$14, min_stock_alert=$15, active=TRUE, updated_at=CURRENT_TIMESTAMP
                         WHERE id=$16`,
                        [sku, barcode, name, category, subCategory, size, colour, fabricType, rackLocation, hsnCode, costPrice, mrpPrice, sellingPrice, stockQty, minAlert, id]
                    );
                    if (stockQty !== oldQty) {
                        await client.query(
                            `INSERT INTO stock_ledger (garment_id, sku, change_qty, balance_after, movement_type, reference_no, remarks)
                             VALUES ($1,$2,$3,$4,'MANUAL_EDIT','EDIT','Inventory Record Updated')`,
                            [id, sku, stockQty - oldQty, stockQty]
                        );
                    }
                } else {
                    const ins = await client.query(
                        `INSERT INTO garments
                         (record_uuid, sku, barcode, name, category, sub_category, size, colour, fabric_type, rack_location, hsn_code, cost_price, mrp_price, selling_price, stock_qty, min_stock_alert)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
                         RETURNING id`,
                        [recUuid, sku, barcode, name, category, subCategory, size, colour, fabricType, rackLocation, hsnCode, costPrice, mrpPrice, sellingPrice, stockQty, minAlert]
                    );
                    await client.query(
                        `INSERT INTO stock_ledger (garment_id, sku, change_qty, balance_after, movement_type, reference_no, remarks)
                         VALUES ($1,$2,$3,$4,'NEW_ITEM','NEW','New SKU Added')`,
                        [ins.rows[0].id, sku, stockQty, stockQty]
                    );
                }
                return { ok: true };
            });
            return res.status(200).json({ ok: true, writtenTo: out.writtenTo, mirrored: out.mirrored });
        }

        if (action === "matrix") {
            const baseName = String(body.name || "").trim();
            if (!baseName) return res.status(400).json({ ok: false, error: "Garment Style Name is required." });
            const skuPrefix = String(body.sku_prefix || "SKU-MAT").trim().toUpperCase();
            const category = String(body.category || "Handwork Sherwani").trim();
            const rackLocation = String(body.rack_location || "RACK-A1").trim();
            const hsnCode = String(body.hsn_code || "6203").trim();
            const costPrice = Number(body.cost_price || 0);
            const sellingPrice = Number(body.selling_price || 0);
            const qtyEach = Number(body.stock_qty || 4);
            const sizes = Array.isArray(body.sizes) && body.sizes.length ? body.sizes : ["40"];
            const colours = Array.isArray(body.colours) && body.colours.length ? body.colours : ["Ivory"];
            const stamp = String(Date.now()).slice(-4);

            const variants = [];
            let idx = 1;
            for (const col of colours) {
                const colCode = col.split(/\s+/).map((w) => w[0] || "").join("").toUpperCase() || "CL";
                for (const sz of sizes) {
                    const sku = `${skuPrefix}-${colCode}-${sz}-${stamp}${idx}`;
                    const barcode = `890${stamp}${String(idx).padStart(3, "0")}`;
                    variants.push({ sku, barcode, sz, col });
                    idx++;
                }
            }

            const out = await runDualWrite(async (client) => {
                for (const v of variants) {
                    const ins = await client.query(
                        `INSERT INTO garments
                         (sku, barcode, name, category, sub_category, size, colour, rack_location, hsn_code, cost_price, mrp_price, selling_price, stock_qty, min_stock_alert)
                         VALUES ($1,$2,$3,$4,'Men''s Wear',$5,$6,$7,$8,$9,$10,$11,$12,2)
                         ON CONFLICT (sku) DO NOTHING RETURNING id`,
                        [v.sku, v.barcode, baseName, category, v.sz, v.col, rackLocation, hsnCode, costPrice, sellingPrice, sellingPrice, qtyEach]
                    );
                    if (ins.rowCount > 0) {
                        await client.query(
                            `INSERT INTO stock_ledger (garment_id, sku, change_qty, balance_after, movement_type, reference_no, remarks)
                             VALUES ($1,$2,$3,$4,'MATRIX_GEN','MATRIX','Size x Colour Bulk Matrix')`,
                            [ins.rows[0].id, v.sku, qtyEach, qtyEach]
                        );
                    }
                }
                return { created: variants.length };
            });

            return res.status(200).json({ ok: true, created: out.result.created, writtenTo: out.writtenTo, mirrored: out.mirrored });
        }

        if (action === "adjustStock") {
            const sku = String(body.sku || "").trim().toUpperCase();
            const id = body.id ? Number(body.id) : null;
            const delta = Number(body.delta || 0);
            const remarks = String(body.remarks || "Quick Stock Adjustment");

            const out = await runDualWrite(async (client) => {
                const up = sku
                    ? await client.query(
                          `UPDATE garments SET stock_qty = GREATEST(0, stock_qty + $1), updated_at = CURRENT_TIMESTAMP WHERE sku = $2 RETURNING id, sku, stock_qty`,
                          [delta, sku]
                      )
                    : await client.query(
                          `UPDATE garments SET stock_qty = GREATEST(0, stock_qty + $1), updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, sku, stock_qty`,
                          [delta, id]
                      );
                if (up.rowCount > 0) {
                    const g = up.rows[0];
                    await client.query(
                        `INSERT INTO stock_ledger (garment_id, sku, change_qty, balance_after, movement_type, reference_no, remarks)
                         VALUES ($1,$2,$3,$4,'STOCK_ADJUST','ADJ',$5)`,
                        [g.id, g.sku, delta, g.stock_qty, remarks]
                    );
                }
                return { ok: true };
            });
            return res.status(200).json({ ok: true, writtenTo: out.writtenTo });
        }

        if (action === "delete") {
            const sku = String(body.sku || "").trim().toUpperCase();
            const id = body.id ? Number(body.id) : null;
            await runDualWrite(async (client) => {
                if (sku) await client.query("UPDATE garments SET active = FALSE WHERE sku = $1", [sku]);
                else if (id) await client.query("UPDATE garments SET active = FALSE WHERE id = $1", [id]);
            });
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ ok: false, error: "Unknown action" });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};
