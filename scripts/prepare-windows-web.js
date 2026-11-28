const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ERP_PUBLIC = path.join(ROOT, "apps", "inventory-crm", "public");
const POS_PUBLIC = path.join(ROOT, "apps", "billing-counter", "public");
const WIN_DIR = path.join(ROOT, "apps", "windows-native");
const DIST_DIR = path.join(WIN_DIR, "dist");
const BRIDGE_SRC = path.join(WIN_DIR, "web-adapter", "tauri-bridge.js");
const ICONS_DIR = path.join(WIN_DIR, "src-tauri", "icons");

function copyRecursive(src, dest) {
    if (!fs.existsSync(src)) return;
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src)) {
            copyRecursive(path.join(src, entry), path.join(dest, entry));
        }
    } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
    }
}

function injectTauriBridge(html) {
    let out = html
        .replace(/src="\/assets\//g, 'src="assets/')
        .replace(/href="\/assets\//g, 'href="assets/')
        .replace(/href="\/manifest\.json"/g, 'href="manifest.json"');

    // Disable serviceWorker registration inside native WebView2 bundle
    out = out.replace(
        'if ("serviceWorker" in navigator)',
        'if (!window.IS_NATIVE_WINDOWS && "serviceWorker" in navigator)'
    );

    if (!out.includes("tauri-bridge.js")) {
        out = out.replace(
            '<script src="app.js"></script>',
            '<script src="app.js"></script>\n<script src="tauri-bridge.js"></script>'
        );
    }
    return out;
}

function prepare() {
    fs.mkdirSync(DIST_DIR, { recursive: true });
    fs.mkdirSync(ICONS_DIR, { recursive: true });

    // Copy shared static assets & vendor scripts
    copyRecursive(path.join(ERP_PUBLIC, "assets"), path.join(DIST_DIR, "assets"));
    copyRecursive(path.join(ERP_PUBLIC, "vendor"), path.join(DIST_DIR, "vendor"));
    fs.copyFileSync(path.join(ERP_PUBLIC, "app.js"), path.join(DIST_DIR, "app.js"));
    fs.copyFileSync(path.join(ERP_PUBLIC, "manifest.json"), path.join(DIST_DIR, "manifest.json"));
    fs.copyFileSync(BRIDGE_SRC, path.join(DIST_DIR, "tauri-bridge.js"));

    // Prepare ERP (index.html) and dedicated POS Counter (pos.html)
    const erpHtml = fs.readFileSync(path.join(ERP_PUBLIC, "index.html"), "utf8");
    const posHtml = fs.readFileSync(path.join(POS_PUBLIC, "index.html"), "utf8");
    fs.writeFileSync(path.join(DIST_DIR, "index.html"), injectTauriBridge(erpHtml), "utf8");
    fs.writeFileSync(path.join(DIST_DIR, "pos.html"), injectTauriBridge(posHtml), "utf8");

    // Copy Tauri icons from verified PNG/ICO assets
    const icoSrc = path.join(ERP_PUBLIC, "assets", "app_icon.ico");
    const pngSrc = path.join(ERP_PUBLIC, "assets", "app_icon.png");
    if (fs.existsSync(icoSrc)) fs.copyFileSync(icoSrc, path.join(ICONS_DIR, "icon.ico"));
    if (fs.existsSync(pngSrc)) fs.copyFileSync(pngSrc, path.join(ICONS_DIR, "icon.png"));

    console.log("[OK] Prepared native Windows frontend dist/ + icons/ in apps/windows-native/");
}

prepare();
