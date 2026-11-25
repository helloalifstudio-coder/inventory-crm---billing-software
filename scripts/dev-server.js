#!/usr/bin/env node
/**
 * Local Development & Verification Server for both Vercel Products:
 *   - Inventory & CRM   -> http://127.0.0.1:3000 (PORT)
 *   - Billing Counter   -> http://127.0.0.1:3001 (POS_PORT)
 * Automatically loads .env.local / .env (including Neon DATABASE_URL).
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const { URL } = require("url");

const ROOT_DIR = path.resolve(__dirname, "..");

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

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".woff2": "font/woff2",
};

function createAppServer(appName) {
    const appRoot = path.join(ROOT_DIR, "apps", appName);
    const pubRoot = path.join(appRoot, "public");

    return http.createServer(async (req, res) => {
        const urlObj = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
        const pathname = decodeURIComponent(urlObj.pathname);

        // Augment Node res to match Vercel Serverless response helpers
        res.status = (code) => {
            res.statusCode = code;
            return res;
        };
        res.json = (obj) => {
            if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify(obj));
            return res;
        };
        res.send = (body) => {
            res.end(body);
            return res;
        };

        req.query = Object.fromEntries(urlObj.searchParams.entries());

        if (pathname.startsWith("/api/")) {
            const route = pathname.slice(5).replace(/[^a-zA-Z0-9_-]/g, "");
            const handlerPath = path.join(appRoot, "api", `${route}.js`);
            if (!fs.existsSync(handlerPath)) {
                return res.status(404).json({ ok: false, error: `Unknown API route: ${pathname}` });
            }

            const chunks = [];
            for await (const ch of req) chunks.push(ch);
            const rawBody = Buffer.concat(chunks).toString("utf8");
            try {
                req.body = rawBody ? JSON.parse(rawBody) : {};
            } catch (_) {
                req.body = rawBody;
            }

            try {
                const handler = require(handlerPath);
                await handler(req, res);
            } catch (err) {
                if (!res.headersSent) {
                    res.status(500).json({ ok: false, error: err.message });
                }
            }
            return;
        }

        // Static / SPA file routing mirroring vercel.json
        let filePath = null;
        if (pathname === "/" || pathname === "/erp" || pathname === "/pos" || pathname === "/pos.html") {
            filePath = path.join(pubRoot, "index.html");
        } else {
            const safeRel = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
            const candidate = path.join(pubRoot, safeRel);
            if (candidate.startsWith(pubRoot) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                filePath = candidate;
            } else {
                filePath = path.join(pubRoot, "index.html");
            }
        }

        const ext = path.extname(filePath).toLowerCase();
        res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
        fs.createReadStream(filePath).pipe(res);
    });
}

function startServers({ invPort = Number(process.env.PORT || 3000), billPort = Number(process.env.POS_PORT || 3001) } = {}) {
    return new Promise((resolve, reject) => {
        const s1 = createAppServer("inventory-crm");
        const s2 = createAppServer("billing-counter");
        let done = 0;
        const onReady = () => {
            done++;
            if (done === 2) resolve({ invServer: s1, billServer: s2, invPort: s1.address().port, billPort: s2.address().port });
        };
        s1.on("error", reject);
        s2.on("error", reject);
        s1.listen(invPort, "127.0.0.1", onReady);
        s2.listen(billPort, "127.0.0.1", onReady);
    });
}

if (require.main === module) {
    startServers()
        .then(({ invPort, billPort }) => {
            console.log(`[READY] Inventory & CRM:   http://127.0.0.1:${invPort}`);
            console.log(`[READY] Billing Counter:   http://127.0.0.1:${billPort}`);
        })
        .catch((err) => {
            console.error("Failed to start servers:", err);
            process.exit(1);
        });
}

module.exports = { startServers, createAppServer };
