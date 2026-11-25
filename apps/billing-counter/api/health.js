const path = require("path");
const { getDualDbStatus } = require("../lib/db");

let pkgName = "showroom-cloud-app";
try {
    pkgName = require(path.resolve(__dirname, "..", "package.json")).name || pkgName;
} catch (_) {}

module.exports = async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    const sessionSecret = String(process.env.SESSION_SECRET || "");
    const envCheck = {
        DATABASE_URL: Boolean(process.env.DATABASE_URL || process.env.PRIMARY_DATABASE_URL || process.env.POSTGRES_URL),
        DATABASE_URL_UNPOOLED: Boolean(process.env.DATABASE_URL_UNPOOLED),
        PRIMARY_DATABASE_URL: Boolean(process.env.PRIMARY_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL),
        SECONDARY_DATABASE_URL: Boolean(process.env.SECONDARY_DATABASE_URL),
        PRIMARY_MAX_MB: Boolean(process.env.PRIMARY_MAX_MB),
        OWNER_PIN: Boolean(process.env.OWNER_PIN),
        STAFF_PIN: Boolean(process.env.STAFF_PIN),
        SESSION_SECRET: Boolean(sessionSecret),
        SESSION_SECRET_STRONG: sessionSecret.length >= 16,
    };

    try {
        const dualDb = await getDualDbStatus();
        return res.status(200).json({
            ok: Boolean(dualDb.primary.online || dualDb.secondary.online),
            product: pkgName,
            powered_by: "Alif Growth Media",
            env_configured: envCheck,
            dual_db: dualDb,
            routes: {
                app_home: "/",
                health_check: "/api/health",
            },
        });
    } catch (err) {
        return res.status(500).json({
            ok: false,
            product: pkgName,
            powered_by: "Alif Growth Media",
            env_configured: envCheck,
            error: err.message,
        });
    }
};
