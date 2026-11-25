#!/usr/bin/env node
/**
 * Production Dual-Database Migration Runner
 * Applies database/migrations/V001..V003 + lib/db.js schema parity checks
 * across BOTH PRIMARY_DATABASE_URL and SECONDARY_DATABASE_URL.
 *
 * Usage:
 *   npm run migrate
 *   npm run migrate:status
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { ensureSchema } = require("../apps/inventory-crm/lib/db");

const ROOT_DIR = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const STATUS_ONLY = process.argv.includes("--status") || process.argv.includes("--dry-run");

function loadDotEnv(filePath) {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (!(key in process.env)) {
            process.env[key] = val;
        }
    }
}

loadDotEnv(path.join(ROOT_DIR, ".env.local"));
loadDotEnv(path.join(ROOT_DIR, ".env"));

function deriveDirectUrl(connStr) {
    if (!connStr) return "";
    // Per Neon best practices, schema migrations prefer a direct (non -pooler) endpoint
    return connStr.replace("-pooler.", ".");
}

function createPool(connStr) {
    const isLocal = connStr.includes("127.0.0.1") || connStr.includes("localhost");
    return new Pool({
        connectionString: connStr,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        max: 3,
        connectionTimeoutMillis: 12000,
    });
}

function maskUrl(connStr) {
    try {
        const u = new URL(connStr);
        return `${u.protocol}//${u.username ? u.username + ":***@" : ""}${u.host}${u.pathname}`;
    } catch (_) {
        return "[configured]";
    }
}

async function applySqlFile(pool, fileName, sqlText) {
    const isIndexMigration = fileName.startsWith("V002");
    if (!isIndexMigration) {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(sqlText);
            await client.query(
                "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING",
                [fileName]
            );
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            throw err;
        } finally {
            client.release();
        }
        return;
    }

    const statements = sqlText
        .split(/;\s*(?:\r?\n|$)/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("--"));

    for (const stmt of statements) {
        try {
            await pool.query(stmt);
        } catch (err) {
            if (stmt.toLowerCase().includes("pg_trgm") || stmt.toLowerCase().includes("gin_trgm_ops")) {
                console.log(`    [Notice] Optional pg_trgm skipped on restricted role (${err.message})`);
            } else {
                throw err;
            }
        }
    }
    await pool.query(
        "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING",
        [fileName]
    );
}

async function migrateTarget(label, connStr, migrationFiles) {
    console.log(`\n--------------------------------------------------------------------`);
    console.log(`Target: ${label}`);
    if (!connStr) {
        console.log(`  Status: SKIPPED (environment variable not set)`);
        return { label, configured: false, ok: label !== "Primary Database" };
    }
    console.log(`  Endpoint: ${maskUrl(connStr)}`);

    const pool = createPool(connStr);
    const t0 = Date.now();
    try {
        await pool.query("SELECT 1");
        if (!STATUS_ONLY) {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version VARCHAR(120) PRIMARY KEY,
                    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
            `);

            const appliedRes = await pool.query("SELECT version FROM schema_migrations");
            const appliedSet = new Set(appliedRes.rows.map((r) => r.version));

            for (const fileName of migrationFiles) {
                const sqlPath = path.join(MIGRATIONS_DIR, fileName);
                const sqlText = fs.readFileSync(sqlPath, "utf8");
                if (appliedSet.has(fileName)) {
                    console.log(`  [=] Already applied: ${fileName}`);
                } else {
                    await applySqlFile(pool, fileName, sqlText);
                    console.log(`  [+] Applied migration: ${fileName}`);
                }
            }

            await ensureSchema(pool);
            console.log(`  [+] Verified runtime schema parity via lib/db.js ensureSchema()`);
        }

        const [sizeRes, countsRes, migRes] = await Promise.all([
            pool.query("SELECT pg_database_size(current_database())::bigint AS bytes"),
            pool.query(`
                SELECT
                    (SELECT COUNT(*)::int FROM garments WHERE active = TRUE) AS garments,
                    (SELECT COUNT(*)::int FROM customers) AS customers,
                    (SELECT COUNT(*)::int FROM bills) AS bills
            `),
            pool.query("SELECT version FROM schema_migrations ORDER BY version ASC"),
        ]);

        const mb = (Number(sizeRes.rows[0].bytes || 0) / (1024 * 1024)).toFixed(2);
        const c = countsRes.rows[0];
        console.log(`  Status: ONLINE (${Date.now() - t0} ms) | Size: ${mb} MB`);
        console.log(`  Rows:   garments=${c.garments}, customers=${c.customers}, bills=${c.bills}`);
        console.log(`  Schema: ${migRes.rows.map((r) => r.version).join(", ") || "none"}`);
        return { label, configured: true, ok: true };
    } catch (err) {
        console.error(`  [ERROR] ${label} failed: ${err.message}`);
        return { label, configured: true, ok: false, error: err.message };
    } finally {
        await pool.end().catch(() => {});
    }
}

async function main() {
    console.log("====================================================================");
    console.log("  AGM SHOWROOM SUITE - DUAL POSTGRESQL MIGRATION RUNNER");
    console.log("  Mode:", STATUS_ONLY ? "STATUS CHECK (--status)" : "APPLY MIGRATIONS");
    console.log("====================================================================");

    const rawPrimary = process.env.PRIMARY_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
    const explicitUnpooled = process.env.DATABASE_URL_UNPOOLED || "";
    let primaryUrl = explicitUnpooled || deriveDirectUrl(rawPrimary) || rawPrimary;
    const secondaryUrl = process.env.SECONDARY_DATABASE_URL || "";

    if (!primaryUrl && !secondaryUrl) {
        console.error("\n[ERROR] No database URL found.");
        console.error("Set PRIMARY_DATABASE_URL (and optional SECONDARY_DATABASE_URL) in .env or environment.");
        process.exit(1);
    }

    const migrationFiles = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort();

    let pRes = await migrateTarget("Primary Database", primaryUrl, migrationFiles);
    if (!pRes.ok && rawPrimary && primaryUrl !== rawPrimary) {
        console.log("\n  [Fallback] Direct hostname unavailable; retrying via supplied pooled URL...");
        pRes = await migrateTarget("Primary Database (Pooled)", rawPrimary, migrationFiles);
    }
    const sRes = await migrateTarget("Secondary Database (Failover + Excess)", secondaryUrl, migrationFiles);

    console.log("\n====================================================================");
    if (pRes.ok && sRes.ok) {
        console.log("  MIGRATION COMPLETE — READY FOR BOTH VERCEL DEPLOYMENTS!");
        console.log("====================================================================");
        process.exit(0);
    } else {
        console.error("  MIGRATION FINISHED WITH ERRORS — SEE LOG ABOVE.");
        console.log("====================================================================");
        process.exit(1);
    }
}

main().catch((err) => {
    console.error("Fatal migration error:", err);
    process.exit(1);
});
