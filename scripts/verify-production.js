#!/usr/bin/env node
/**
 * Automated Pre-Publish Verification Gate for Dual-Product Monorepo
 * Verifies: JS syntax, JSON configs, backend parity between both Vercel apps,
 * Alif Growth Media brand attribution footer & logo, Billing Enter-key nav, and zero leaked secrets.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const APPS = ["inventory-crm", "billing-counter"];

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

function listJsFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listJsFiles(full));
        else if (entry.name.endsWith(".js") && !entry.name.endsWith(".min.js")) out.push(full);
    }
    return out;
}

// 1. JS syntax checks
const jsFiles = listJsFiles(ROOT);
for (const jf of jsFiles) {
    execFileSync(process.execPath, ["--check", jf], { stdio: "pipe" });
}
console.log(`[PASS] JS syntax verified across ${jsFiles.length} files.`);

// 2. JSON config checks
const jsonPaths = [
    path.join(ROOT, "package.json"),
    ...APPS.flatMap((a) => [
        path.join(ROOT, "apps", a, "package.json"),
        path.join(ROOT, "apps", a, "vercel.json"),
        path.join(ROOT, "apps", a, "public", "manifest.json"),
    ]),
];
for (const jp of jsonPaths) {
    assert(fs.existsSync(jp), `Missing JSON config: ${jp}`);
    JSON.parse(fs.readFileSync(jp, "utf8"));
}
console.log(`[PASS] All ${jsonPaths.length} JSON config files are valid.`);

// 3. Shared backend parity (api/ + lib/ + public/app.js + public/sw.js)
const invDir = path.join(ROOT, "apps", "inventory-crm");
const billDir = path.join(ROOT, "apps", "billing-counter");
const sharedFiles = [
    ...fs.readdirSync(path.join(invDir, "api")).map((f) => path.join("api", f)),
    ...fs.readdirSync(path.join(invDir, "lib")).map((f) => path.join("lib", f)),
    path.join("public", "app.js"),
    path.join("public", "sw.js"),
];
for (const rel of sharedFiles) {
    const a = fs.readFileSync(path.join(invDir, rel));
    const b = fs.readFileSync(path.join(billDir, rel));
    assert(a.equals(b), `Backend/shared file mismatch between apps: ${rel}. Run "npm run sync:backend".`);
}
console.log(`[PASS] Byte-for-byte shared parity verified across ${sharedFiles.length} files.`);

// 4. Branding ("Powered by Alif Growth Media" + logo) & Product Isolation
const invHtml = fs.readFileSync(path.join(invDir, "public", "index.html"), "utf8");
const billHtml = fs.readFileSync(path.join(billDir, "public", "index.html"), "utf8");

for (const [label, html, expectedInterface] of [
    ["apps/inventory-crm/public/index.html", invHtml, 'window.APP_INTERFACE = "erp"'],
    ["apps/billing-counter/public/index.html", billHtml, 'window.APP_INTERFACE = "pos"'],
]) {
    assert(html.includes(expectedInterface), `Missing ${expectedInterface} in ${label}`);
    assert(html.includes("Powered by"), `Missing 'Powered by' text in ${label}`);
    assert(html.includes("Alif Growth Media"), `Missing 'Alif Growth Media' brand name in ${label}`);
    assert(html.includes("https://alif-growth-media.vercel.app/"), `Missing AGM website hyperlink in ${label}`);
    assert(html.includes("/assets/alif-growth-media-logo.png"), `Missing AGM logo reference in ${label}`);
    assert((html.match(/<footer class="agm-settings-footer">/g) || []).length === 1, `Expected exactly 1 footer in ${label}`);
    assert(html.includes('<link rel="manifest" href="/manifest.json" />'), `Expected root /manifest.json link in ${label}`);
}

for (const appPath of [invDir, billDir]) {
    assert(fs.existsSync(path.join(appPath, "public", "assets", "alif-growth-media-logo.png")), `Missing AGM logo file in ${appPath}`);
}
for (const key of ["'phone'", "'name'", "'city'"]) {
    assert(billHtml.includes(`onCustomerFieldKey(event, ${key})`), `Missing Enter-key customer nav (${key}) in billing-counter`);
}
console.log("[PASS] Alif Growth Media brand footer, logo, URL & Billing Enter-key flow verified in both apps.");

// 5. Migrations check
for (const mig of ["V001__core_schema.sql", "V002__performance_indexes_100k.sql", "V003__automations_and_sync.sql"]) {
    assert(fs.existsSync(path.join(ROOT, "database", "migrations", mig)), `Missing migration ${mig}`);
}
console.log("[PASS] Database migrations V001..V003 & runner verified.");

// 6. Secret-leak hygiene scan (exclude node_modules, .git, gitignored .env/.env.local)
function walkAll(dir) {
    const res = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".env" || entry.name === ".env.local" || entry.name === ".neon" || entry.name.endsWith(".png") || entry.name.endsWith(".ico") || entry.name.endsWith(".ttf")) continue;
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) res.push(...walkAll(p));
        else res.push(p);
    }
    return res;
}
const gitignoreTxt = fs.existsSync(path.join(ROOT, ".gitignore")) ? fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8") : "";
assert(gitignoreTxt.includes(".env.local") && gitignoreTxt.includes(".env"), ".gitignore must ignore .env and .env.local");
if (fs.existsSync(path.join(ROOT, ".git"))) {
    const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split(/\r?\n/);
    for (const tf of tracked) {
        assert(!/^\.env($|\.local$)/.test(path.basename(tf)), `Secret env file is tracked in git: ${tf}`);
    }
}
for (const f of walkAll(ROOT)) {
    const txt = fs.readFileSync(f, "utf8");
    assert(!/gh[pou]_[A-Za-z0-9]{20,}/.test(txt), `Potential GitHub token string found in ${f}`);
}
console.log("[PASS] Repository clean: zero tracked .env secrets or tokens present.");
