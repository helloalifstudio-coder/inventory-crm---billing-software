const crypto = require("crypto");
const { requireAuth, parseBody } = require("../lib/auth");
const { queryRead, queryBothMerged, runDualWrite } = require("../lib/db");

module.exports = async function handler(req, res) {
    const session = requireAuth(req, res, "any");
    if (!session) return;

    try {
        if (req.method === "GET") {
            const action = req.query.action || "list";

            if (action === "findByPhone") {
                const phone = String(req.query.phone || "").trim();
                if (!phone) return res.status(200).json({ ok: true, customer: null });
                const r = await queryRead("SELECT * FROM customers WHERE phone = $1 LIMIT 1", [phone]);
                return res.status(200).json({ ok: true, customer: r.rows[0] || null });
            }

            if (action === "history") {
                const id = Number(req.query.id || 0);
                const custRes = await queryRead("SELECT * FROM customers WHERE id = $1", [id]);
                const cust = custRes.rows[0];
                if (!cust) return res.status(200).json({ ok: true, customer: null, bills: [], purchased_items: [] });

                const [bills, purchasedItems] = await Promise.all([
                    queryBothMerged(
                        "SELECT * FROM bills WHERE customer_phone = $1 ORDER BY created_at DESC",
                        [cust.phone],
                        "bill_no"
                    ),
                    queryBothMerged(
                        `SELECT bi.*, b.bill_no, b.created_at AS bill_date, b.payment_mode,
                                CONCAT(b.bill_no, ':', bi.sku, ':', COALESCE(NULLIF(bi.record_uuid,''), CAST(bi.qty AS TEXT))) AS dedupe_key
                         FROM bill_items bi
                         JOIN bills b ON b.id = bi.bill_id
                         WHERE b.customer_phone = $1
                         ORDER BY bi.created_at DESC`,
                        [cust.phone],
                        "dedupe_key"
                    ),
                ]);

                bills.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                return res.status(200).json({
                    ok: true,
                    customer: cust,
                    bills,
                    purchased_items: purchasedItems,
                });
            }

            const q = String(req.query.query || "").trim();
            const page = Math.max(1, Number(req.query.page || 1));
            const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize || 50)));
            const offset = (page - 1) * pageSize;
            const sortBy = req.query.sortBy || "recent";

            let orderClause = "ORDER BY last_purchase_at DESC NULLS LAST, id DESC";
            if (sortBy === "spent") orderClause = "ORDER BY total_spent DESC, id DESC";
            if (sortBy === "visits") orderClause = "ORDER BY total_visits DESC, id DESC";
            if (sortBy === "name") orderClause = "ORDER BY full_name ASC";

            let whereClause = "";
            let params = [];
            if (q) {
                whereClause = "WHERE phone LIKE $1 OR full_name ILIKE $2 OR customer_code ILIKE $2 OR city ILIKE $2";
                params = [`${q}%`, `%${q}%`];
            }

            const [countRes, rowsRes] = await Promise.all([
                queryRead(`SELECT COUNT(*)::int AS total FROM customers ${whereClause}`, params),
                queryRead(
                    `SELECT * FROM customers ${whereClause} ${orderClause} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
                    [...params, pageSize, offset]
                ),
            ]);

            const totalCount = countRes.rows[0]?.total || 0;
            return res.status(200).json({
                ok: true,
                rows: rowsRes.rows,
                totalCount,
                page,
                pageSize,
                totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
            });
        }

        if (req.method === "POST") {
            const body = parseBody(req);
            const custId = body.id ? Number(body.id) : null;
            const phone = String(body.phone || "").trim();
            const fullName = String(body.full_name || "").trim();
            if (!phone || !fullName) {
                return res.status(400).json({ ok: false, error: "Customer Name and Mobile Number are required." });
            }

            const city = String(body.city || "").trim();
            const address = String(body.address || "").trim();
            const email = String(body.email || "").trim();
            const gstin = String(body.gstin || "").trim();
            const notes = String(body.notes || "").trim();
            const code = `CUST-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
            const recUuid = String(body.record_uuid || crypto.randomUUID());

            const out = await runDualWrite(async (client) => {
                if (custId) {
                    const up = await client.query(
                        `UPDATE customers
                         SET phone = $1, full_name = $2, city = $3, address = $4, email = $5, gstin = $6, notes = $7, updated_at = CURRENT_TIMESTAMP
                         WHERE id = $8
                         RETURNING *`,
                        [phone, fullName, city, address, email, gstin, notes, custId]
                    );
                    if (up.rowCount > 0) return up.rows[0];
                }
                const ins = await client.query(
                    `INSERT INTO customers (record_uuid, customer_code, phone, full_name, city, address, email, gstin, notes)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                     ON CONFLICT (phone) DO UPDATE
                     SET full_name = EXCLUDED.full_name,
                         city = COALESCE(NULLIF(EXCLUDED.city, ''), customers.city),
                         address = COALESCE(NULLIF(EXCLUDED.address, ''), customers.address),
                         email = COALESCE(NULLIF(EXCLUDED.email, ''), customers.email),
                         gstin = COALESCE(NULLIF(EXCLUDED.gstin, ''), customers.gstin),
                         notes = COALESCE(NULLIF(EXCLUDED.notes, ''), customers.notes),
                         updated_at = CURRENT_TIMESTAMP
                     RETURNING *`,
                    [recUuid, code, phone, fullName, city, address, email, gstin, notes]
                );
                return ins.rows[0];
            });

            return res.status(200).json({ ok: true, customer: out.result, writtenTo: out.writtenTo });
        }

        return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};
