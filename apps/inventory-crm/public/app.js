// ============================================================================
// VERCEL CLOUD REST API BRIDGE (Replaces Electron IPC cleanly)
// ============================================================================
async function apiFetch(url, opts = {}) {
    const res = await fetch(url, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
        ...opts,
    });
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (res.status === 401 && data.authRequired) {
        showPinLogin();
    }
    return data;
}

window.appAPI = {
    authStatus: () => apiFetch("/api/auth?action=status"),
    login: (pin) => apiFetch("/api/auth?action=login", { method: "POST", body: JSON.stringify({ pin }) }),
    logout: () => apiFetch("/api/auth?action=logout", { method: "POST" }),
    bootstrap: () => apiFetch("/api/bootstrap"),
    saveGarment: (payload) => apiFetch("/api/garments", { method: "POST", body: JSON.stringify({ action: "save", ...payload }) }),
    generateMatrix: (payload) => apiFetch("/api/garments", { method: "POST", body: JSON.stringify({ action: "matrix", ...payload }) }),
    adjustStock: (payload) => apiFetch("/api/garments", { method: "POST", body: JSON.stringify({ action: "adjustStock", ...payload }) }),
    deleteGarment: (id) => apiFetch("/api/garments", { method: "POST", body: JSON.stringify({ action: "delete", id }) }),
    listCustomers: (params = {}) => {
        const qs = new URLSearchParams({
            action: "list",
            query: params.query || "",
            page: String(params.page || 1),
            pageSize: String(params.pageSize || 50),
            sortBy: params.sortBy || "recent",
        });
        return apiFetch(`/api/customers?${qs.toString()}`);
    },
    findCustomerByPhone: (phone) => apiFetch(`/api/customers?action=findByPhone&phone=${encodeURIComponent(phone || "")}`),
    getCustomerHistory: (customerId) => apiFetch(`/api/customers?action=history&id=${encodeURIComponent(customerId)}`),
    saveCustomer: (payload) => apiFetch("/api/customers", { method: "POST", body: JSON.stringify(payload) }),
    checkoutBill: (payload) => apiFetch("/api/bills", { method: "POST", body: JSON.stringify(payload) }),
    getBillDetail: (billIdOrNo) => {
        const isNo = typeof billIdOrNo === "string" && isNaN(Number(billIdOrNo));
        return apiFetch(isNo ? `/api/bills?bill_no=${encodeURIComponent(billIdOrNo)}` : `/api/bills?id=${encodeURIComponent(billIdOrNo)}`);
    },
    saveSettings: (payload) => apiFetch("/api/settings", { method: "POST", body: JSON.stringify({ action: "saveStore", ...payload }) }),
    saveAutomationSettings: (payload) => apiFetch("/api/settings", { method: "POST", body: JSON.stringify({ action: "saveAutomations", ...payload }) }),
    resendBillNotifications: (billNo) => apiFetch("/api/settings", { method: "POST", body: JSON.stringify({ action: "resendNotification", bill_no: billNo }) }),
    syncSecondary: () => apiFetch("/api/settings", { method: "POST", body: JSON.stringify({ action: "syncSecondary" }) }),
    archiveExcess: (days) => apiFetch("/api/settings", { method: "POST", body: JSON.stringify({ action: "archiveExcess", days }) }),
    retailOverview: () => apiFetch("/api/retail?action=overview"),
    listSuppliers: () => apiFetch("/api/retail?action=suppliers"),
    saveSupplier: (payload) => apiFetch("/api/retail", { method: "POST", body: JSON.stringify({ action: "saveSupplier", ...payload }) }),
    recordPurchase: (payload) => apiFetch("/api/retail", { method: "POST", body: JSON.stringify({ action: "recordPurchase", ...payload }) }),
    listReturns: () => apiFetch("/api/retail?action=returns"),
    checkCreditNote: (code) => apiFetch(`/api/retail?action=checkCreditNote&code=${encodeURIComponent(code || "")}`),
    returnBill: (payload) => apiFetch("/api/bills", { method: "POST", body: JSON.stringify({ action: "return", ...payload }) }),
    listShifts: () => apiFetch("/api/retail?action=shifts"),
    openShift: (payload) => apiFetch("/api/retail", { method: "POST", body: JSON.stringify({ action: "openShift", ...payload }) }),
    closeShift: (payload) => apiFetch("/api/retail", { method: "POST", body: JSON.stringify({ action: "closeShift", ...payload }) }),
    listAlterations: () => apiFetch("/api/retail?action=alterations"),
    saveAlteration: (payload) => apiFetch("/api/retail", { method: "POST", body: JSON.stringify({ action: "saveAlteration", ...payload }) }),
    exportGstr1: () => {
        window.open("/api/retail?action=gstr1", "_blank");
        return Promise.resolve({ ok: true });
    },
    syncCloudNow: () => apiFetch("/api/settings", { method: "POST", body: JSON.stringify({ action: "syncSecondary" }) }),
    getPrinters: () => Promise.resolve({ ok: true, printers: [], native: false }),
    exportCsv: (type) => {
        window.open(`/api/settings?action=exportCsv&type=${encodeURIComponent(type || "bills")}`, "_blank");
        return Promise.resolve({ ok: true });
    },
    openCompanionWindow: () => {
        window.open(window.location.origin + "/pos", "_blank");
    },
    saveReceiptPdf: () => {
        window.print();
        return Promise.resolve({ ok: true, pdfPath: "Browser Print Dialog (Save as PDF)" });
    },
    backupDatabase: async () => {
        const res = await apiFetch("/api/settings", { method: "POST", body: JSON.stringify({ action: "syncSecondary" }) });
        if (res && res.ok) return { ok: true, path: "Mirrored to Secondary Cloud Database" };
        return res || { ok: false, error: "Mirror sync failed" };
    },
    openWhatsApp: ({ phone, text } = {}) => {
        let digits = String(phone || "").replace(/\D/g, "");
        if (digits.length === 10) digits = "91" + digits;
        const url = digits
            ? `https://wa.me/${digits}?text=${encodeURIComponent(String(text || ""))}`
            : `https://wa.me/?text=${encodeURIComponent(String(text || ""))}`;
        window.open(url, "_blank");
        return Promise.resolve({ ok: true });
    },
    endSession: async () => {
        await apiFetch("/api/auth?action=logout", { method: "POST" });
        if (typeof showPinLogin === "function") showPinLogin();
        return { ok: true };
    },
    printThermal: () => {
        const mode = (STATE.automations && STATE.automations.printer_mode) || "browser";
        if (mode === "rawbt") {
            const paper = document.getElementById("thermal-paper") || document.getElementById("erp-receipt-paper-host");
            const plain = (paper ? paper.innerText : "Receipt") + "\n\n\n";
            const b64 = btoa(unescape(encodeURIComponent(plain)));
            window.location.href = "rawbt:base64," + b64;
        } else {
            window.print();
        }
    },
};

const STATE = {
    role: "owner",
    dual_db: null,
    settings: {},
    automations: {},
    garments: [],
    kpis: {},
    categories: [],
    recent_bills: [],
    stock_ledger: [],
    notification_logs: [],
    printers: [],
    migrations: [],
    next_bill_no: "INV-00001",

    // POS State
    cart: [],
    matchedCustomer: null,
    lastBill: null,
    lastBillItems: null,

    // 100k Customer Directory State
    custRows: [],
    custTotal: 0,
    custPage: 1,
    custTotalPages: 1,
    selectedCustomer: null,
};

const VIEW_TITLES = {
    "view-dashboard": "Overview",
    "view-billing": "Billing Counter",
    "view-inventory": "Garment Stock & Inventory",
    "view-matrix": "Size × Colour Bulk Variant Matrix",
    "view-customers": "Customers & Purchase History",
    "view-settings": "Settings",
};

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function fmtINR(val) {
    const n = Number(val || 0);
    return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(val) {
    if (!val) return "—";
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

// ============================================================================
// DRAGGABLE & COLLAPSIBLE SIDEBAR
// ============================================================================
function toggleSidebarCollapse() {
    const sb = document.getElementById("app-sidebar");
    sb.classList.toggle("collapsed");
}

function initSidebarDragResize() {
    const sidebar = document.getElementById("app-sidebar");
    const resizer = document.getElementById("sidebar-resizer");
    if (!sidebar || !resizer) return;

    let isDragging = false;

    resizer.addEventListener("mousedown", (e) => {
        isDragging = true;
        resizer.classList.add("dragging");
        document.body.style.cursor = "col-resize";
        e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        const newWidth = e.clientX;
        if (newWidth < 85) {
            sidebar.classList.add("collapsed");
        } else {
            sidebar.classList.remove("collapsed");
            const clamped = Math.min(340, Math.max(150, newWidth));
            sidebar.style.width = clamped + "px";
        }
    });

    window.addEventListener("mouseup", () => {
        if (!isDragging) return;
        isDragging = false;
        resizer.classList.remove("dragging");
        document.body.style.cursor = "";
    });
}

// ============================================================================
// FONT SIZE & TYPOGRAPHY SETTINGS
// ============================================================================
function loadSavedTypography() {
    const savedSize = localStorage.getItem("app_font_size") || "13";
    const savedFont = localStorage.getItem("app_font_family") || '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif';
    document.documentElement.style.setProperty("--base-font-size", savedSize + "px");
    document.documentElement.style.setProperty("--font-sans", savedFont);

    const sizeInput = document.getElementById("ui-font-size");
    const fontSelect = document.getElementById("ui-font-family");
    const lblPx = document.getElementById("lbl-font-px");
    if (sizeInput) sizeInput.value = savedSize;
    if (fontSelect) fontSelect.value = savedFont;
    if (lblPx) lblPx.textContent = savedSize + "px";
}

function applyTypographySettings() {
    const sizeVal = document.getElementById("ui-font-size").value;
    const fontVal = document.getElementById("ui-font-family").value;
    document.documentElement.style.setProperty("--base-font-size", sizeVal + "px");
    document.documentElement.style.setProperty("--font-sans", fontVal);
    document.getElementById("lbl-font-px").textContent = sizeVal + "px";
    localStorage.setItem("app_font_size", sizeVal);
    localStorage.setItem("app_font_family", fontVal);
}

function setFontSizePreset(px) {
    document.getElementById("ui-font-size").value = String(px);
    applyTypographySettings();
}

function resetTypographySettings() {
    document.getElementById("ui-font-size").value = "13";
    document.getElementById("ui-font-family").selectedIndex = 0;
    applyTypographySettings();
}

// ============================================================================
// VIEW NAVIGATION
// ============================================================================
function switchView(viewId) {
    if (window.APP_INTERFACE === "pos") {
        if (viewId === "view-settings") {
            openPosSettingsDrawer("stab-general");
            return;
        }
        const billingPane = document.getElementById("view-billing");
        if (billingPane) billingPane.classList.add("active");
        setTimeout(() => {
            const scan = document.getElementById("pos-scan");
            if (scan) scan.focus();
        }, 50);
        renderThermalPreview();
        return;
    }
    if (window.APP_INTERFACE === "erp" && viewId === "view-billing") {
        viewId = "view-dashboard";
    }
    document.querySelectorAll(".view-pane").forEach((v) => v.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));

    if (typeof closeFloatingSidebar === "function") closeFloatingSidebar();
    if (typeof closeFloatingSidebar === "function") closeFloatingSidebar();
    const target = document.getElementById(viewId);
    if (target) target.classList.add("active");

    const btn = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
    if (btn) btn.classList.add("active");

    document.getElementById("topbar-title").textContent = VIEW_TITLES[viewId] || "Workspace";

    // Keep Overview Dashboard header completely clean (zero export/add SKU buttons beside Overview heading)
    const actionsEl = document.getElementById("topbar-context-actions");
    if (viewId === "view-dashboard") {
        actionsEl.innerHTML = "";
    } else if (viewId === "view-billing") {
        actionsEl.innerHTML = `<button type="button" class="btn btn-xs" onclick="openCompanion()">+ Open Separate POS Window</button>`;
        setTimeout(() => {
            const scan = document.getElementById("pos-scan");
            if (scan) scan.focus();
        }, 50);
        renderThermalPreview();
    } else {
        actionsEl.innerHTML = "";
    }

    if (viewId === "view-customers") {
        searchCustomers(STATE.custPage);
    }
}

async function refreshAll() {
    const data = await window.appAPI.bootstrap();
    if (!data || !data.ok) return;

    STATE.role = data.role || "owner";
    STATE.dual_db = data.dual_db || null;
    STATE.settings = data.settings || {};
    STATE.automations = data.automations || {};
    STATE.garments = data.garments || [];
    STATE.kpis = data.kpis || {};
    STATE.categories = data.categories || [];
    STATE.recent_bills = data.recent_bills || [];
    STATE.stock_ledger = data.stock_ledger || [];
    STATE.notification_logs = data.notification_logs || [];
    STATE.next_bill_no = data.next_bill_no || "INV-00001";

    // Hide Settings nav for staff role
    const setBtn = document.querySelector('.nav-btn[data-view="view-settings"]');
    if (setBtn) setBtn.style.display = STATE.role === "owner" ? "flex" : "none";

    const billNoEl = document.getElementById("pos-bill-no");
    if (billNoEl) billNoEl.textContent = STATE.next_bill_no;
    const taxModeEl = document.getElementById("pos-tax-mode");
    if (taxModeEl && !STATE.cart.length) taxModeEl.value = STATE.settings.tax_mode || "exclusive";
    const rollEl = document.getElementById("thermal-roll-size");
    if (rollEl) rollEl.value = STATE.settings.thermal_width || "80mm";
    setThermalRoll(STATE.settings.thermal_width || "80mm");

    renderDashboard();
    renderInventoryGrid();
    renderPosGrid();
    renderSettingsAndMigrations();
    renderAutomationsAndLogs();
    renderDualDbStatus();
    renderThermalPreview();
    updatePrinterPill();
}

// ============================================================================
// 1. DASHBOARD
// ============================================================================
function renderDashboard() {
    const k = STATE.kpis;
    if (!document.getElementById("kpi-today-rev")) return;
    document.getElementById("kpi-today-rev").textContent = fmtINR(k.today_revenue);
    document.getElementById("kpi-today-bills").textContent = `${k.today_bills || 0} Bills Generated Today`;
    document.getElementById("kpi-total-rev").textContent = fmtINR(k.total_revenue);
    document.getElementById("kpi-total-gst").textContent = `GST: ${fmtINR(k.total_gst_collected)} (CGST ${fmtINR(k.total_cgst)} + SGST ${fmtINR(k.total_sgst)})`;
    document.getElementById("kpi-stock-val").textContent = fmtINR(k.retail_valuation);
    document.getElementById("kpi-stock-units").textContent = `${k.total_units || 0} Units across ${k.active_skus || 0} SKUs`;
    document.getElementById("kpi-cust-count").textContent = Number(k.total_customers || 0).toLocaleString("en-IN");
    document.getElementById("kpi-low-stock").textContent = `${k.low_stock_count || 0} Low-Stock Alert SKUs`;

    const cmdBill = document.getElementById("pos-cmd-bill");
    if (cmdBill) cmdBill.textContent = STATE.next_bill_no || "INV-00001";
    const cmdToday = document.getElementById("pos-cmd-today");
    if (cmdToday) cmdToday.textContent = `${fmtINR(k.today_revenue)} (${k.today_bills || 0} Bills)`;
    if (typeof updateHeldCartsBadge === "function") updateHeldCartsBadge();

    const billsTbody = document.getElementById("dash-bills-tbody");
    if (!STATE.recent_bills.length) {
        billsTbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding:24px;color:var(--text-muted);">No bills created yet. Press F1 or click POS Billing to punch a bill.</td></tr>`;
    } else {
        billsTbody.innerHTML = STATE.recent_bills
            .map(
                (b) => `
            <tr>
                <td class="mono"><strong>${escapeHtml(b.bill_no)}</strong>${b.status === "RETURNED" ? ` <span class="badge badge-red">RET</span>` : ""}</td>
                <td class="mono" style="font-size:0.84rem;color:var(--text-muted);">${fmtDate(b.created_at)}</td>
                <td>
                    <strong>${escapeHtml(b.customer_name)}</strong>
                    ${b.customer_phone ? `<span class="mono" style="color:var(--text-secondary);"> (${escapeHtml(b.customer_phone)})</span>` : ""}
                </td>
                <td><span class="badge badge-blue">${escapeHtml(b.payment_mode)}</span></td>
                <td class="text-right mono">${fmtINR(b.total_gst)}</td>
                <td class="text-right mono"><strong>${fmtINR(b.grand_total)}</strong></td>
                <td class="text-center">
                    <div style="display:inline-flex;gap:4px;">
                        <button type="button" class="btn btn-xs btn-dark" onclick="reprintBill(${b.id})">Receipt</button>
                        ${b.customer_phone ? `<button type="button" class="btn btn-xs" title="Send WhatsApp / SMS Bill" onclick="resendBillMsg('${b.bill_no}')">Send Msg</button>` : ""}
                    </div>
                </td>
            </tr>
        `
            )
            .join("");
    }
    const posRecentTbody = document.getElementById("pos-recent-bills-tbody");
    if (posRecentTbody && billsTbody) posRecentTbody.innerHTML = billsTbody.innerHTML;

    const catTbody = document.getElementById("dash-cat-tbody");
    catTbody.innerHTML = STATE.categories
        .map(
            (c) => `
        <tr>
            <td><strong>${c.category}</strong></td>
            <td class="text-center mono">${c.sku_count}</td>
            <td class="text-center"><span class="badge badge-green">${c.total_units}</span></td>
            <td class="text-right mono"><strong>${fmtINR(c.stock_value)}</strong></td>
        </tr>
    `
        )
        .join("");

    const lowItems = STATE.garments.filter((g) => g.stock_qty <= g.min_stock_alert);
    const lowTbody = document.getElementById("dash-low-tbody");
    if (!lowItems.length) {
        lowTbody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding:16px;color:var(--green);">All garments above minimum stock threshold.</td></tr>`;
    } else {
        lowTbody.innerHTML = lowItems
            .map((g) => {
                const dailyRate = Math.max(0.25, Number(g.total_sold || 0) / 30);
                const estDays = g.stock_qty <= 0 ? 0 : Math.max(1, Math.round(g.stock_qty / dailyRate));
                const predTag = g.stock_qty <= 0 ? "Out" : `~${estDays}d left`;
                return `
            <tr>
                <td class="mono"><strong>${g.sku}</strong></td>
                <td>${g.name} (${g.size})</td>
                <td class="text-center"><span class="badge badge-red">${g.stock_qty} (${predTag})</span></td>
                <td class="text-right">
                    <button type="button" class="btn btn-xs btn-primary" onclick="quickStock(${g.id}, 5)">+5 Stock</button>
                </td>
            </tr>
        `;
            })
            .join("");
    }
    if (typeof computeSalesForecastChart === "function") computeSalesForecastChart();
}

// ============================================================================
// 2. GARMENT INVENTORY & MATRIX
// ============================================================================
function renderInventoryGrid() {
    if (!document.getElementById("inv-query") || !document.getElementById("inv-tbody")) return;
    const q = (document.getElementById("inv-query").value || "").toLowerCase().trim();
    const cat = document.getElementById("inv-cat").value;
    const status = document.getElementById("inv-status").value;

    const filtered = STATE.garments.filter((g) => {
        if (cat !== "ALL" && g.category !== cat) return false;
        if (status === "LOW" && g.stock_qty > g.min_stock_alert) return false;
        if (status === "OK" && g.stock_qty <= g.min_stock_alert) return false;
        if (q) {
            const hay = `${g.sku} ${g.barcode} ${g.name} ${g.category} ${g.colour} ${g.size} ${g.rack_location || ""}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    const tbody = document.getElementById("inv-tbody");
    if (!filtered.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center" style="padding:52px 20px;">
                    <div style="font-size:1.05rem;font-weight:700;color:#0A0A0A;margin-bottom:6px;">No garments in inventory</div>
                    <div style="font-size:0.86rem;color:#737373;margin-bottom:16px;">Add your first garment SKU or generate a Size &times; Colour matrix to begin tracking stock.</div>
                    <button type="button" class="btn btn-primary" onclick="openGarmentModal()">+ Add First Garment</button>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered
        .map((g) => {
            const gstRate = Number(g.selling_price) <= 2500 ? "5%" : "18%";
            const stockBadge =
                g.stock_qty === 0
                    ? `<span class="badge badge-red">0 &middot; OUT</span>`
                    : g.stock_qty <= g.min_stock_alert
                    ? `<span class="badge badge-amber">${g.stock_qty} &middot; LOW</span>`
                    : `<span class="badge badge-mono-solid">${g.stock_qty}</span>`;
            const metaParts = [g.category, g.fabric_type, g.rack_location].filter(Boolean).map(escapeHtml).join(" &middot; ");

            return `
            <tr>
                <td>
                    <div class="mono" style="font-weight:700;color:#0A0A0A;">${escapeHtml(g.sku)}</div>
                    <div class="mono" style="font-size:0.78rem;color:#737373;margin-top:2px;">${escapeHtml(g.barcode)}</div>
                </td>
                <td>
                    <div style="font-weight:700;color:#0A0A0A;">${escapeHtml(g.name)}</div>
                    <div style="font-size:0.8rem;color:#737373;margin-top:2px;">${metaParts}</div>
                </td>
                <td>
                    <span class="badge badge-blue mono" style="margin-right:4px;">${escapeHtml(g.size)}</span>
                    <span style="font-size:0.86rem;color:#404040;">${escapeHtml(g.colour)}</span>
                </td>
                <td class="text-right">
                    <div class="mono" style="font-weight:800;color:#0A0A0A;">${fmtINR(g.selling_price)}</div>
                    <div class="mono" style="font-size:0.78rem;color:#737373;margin-top:2px;">Cost ${fmtINR(g.cost_price)} &middot; ${gstRate} GST</div>
                </td>
                <td class="text-center">${stockBadge}</td>
                <td class="text-center mono" style="font-weight:700;">${g.total_sold || 0}</td>
                <td class="text-center">
                    <div class="stepper-group">
                        <button type="button" class="stepper-btn" title="Decrease Stock" onclick="quickStock(${g.id}, -1)">&minus;</button>
                        <button type="button" class="stepper-btn" title="Increase Stock" onclick="quickStock(${g.id}, 1)">+</button>
                    </div>
                </td>
                <td class="text-right">
                    <div style="display:inline-flex;gap:5px;">
                        <button type="button" class="btn btn-xs" title="Edit Garment" onclick="editGarment(${g.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>Edit</span></button>
                        <button type="button" class="btn btn-xs btn-dark" title="Print Barcode Tag" onclick="printGarmentTag(${g.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg><span>Tag</span></button>
                        <button type="button" class="btn btn-xs btn-danger" title="Delete Garment" aria-label="Delete Garment" onclick="deleteGarment(${g.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                    </div>
                </td>
            </tr>
        `;
        })
        .join("");
}

async function deleteGarment(id) {
    const g = STATE.garments.find((x) => Number(x.id) === Number(id));
    if (!g) return;
    if (!confirm(`Delete "${g.name}" (${g.sku}) from active inventory?\nPast invoices will remain intact.`)) return;
    await window.appAPI.deleteGarment(id);
    await refreshAll();
}

async function quickStock(id, delta) {
    await window.appAPI.adjustStock({ id, delta });
    await refreshAll();
}

function openGarmentModal() {
    document.getElementById("modal-garment-title").textContent = "Add New Garment SKU";
    document.getElementById("g-id").value = "";
    const nextNum = STATE.garments.length + 101;
    document.getElementById("g-sku").value = `SKU-${nextNum}`;
    document.getElementById("g-barcode").value = `890${nextNum}`;
    document.getElementById("g-name").value = "";
    document.getElementById("g-category").value = "Handwork Sherwani";
    document.getElementById("g-rack").value = "RACK-A1";
    document.getElementById("g-size").value = "40";
    document.getElementById("g-colour").value = "Ivory";
    document.getElementById("g-fabric").value = "";
    document.getElementById("g-cost").value = "4000";
    document.getElementById("g-price").value = "8500";
    document.getElementById("g-stock").value = "5";
    document.getElementById("g-alert").value = "2";
    document.getElementById("g-hsn").value = "6203";
    document.getElementById("modal-garment").classList.add("open");
}

function editGarment(id) {
    const g = STATE.garments.find((x) => Number(x.id) === Number(id));
    if (!g) return;
    document.getElementById("modal-garment-title").textContent = `Edit Garment: ${g.sku}`;
    document.getElementById("g-id").value = g.id;
    document.getElementById("g-sku").value = g.sku;
    document.getElementById("g-barcode").value = g.barcode;
    document.getElementById("g-name").value = g.name;
    document.getElementById("g-category").value = g.category;
    document.getElementById("g-rack").value = g.rack_location || "RACK-A1";
    document.getElementById("g-size").value = g.size;
    document.getElementById("g-colour").value = g.colour;
    document.getElementById("g-fabric").value = g.fabric_type || "";
    document.getElementById("g-cost").value = g.cost_price;
    document.getElementById("g-price").value = g.selling_price;
    document.getElementById("g-stock").value = g.stock_qty;
    document.getElementById("g-alert").value = g.min_stock_alert;
    document.getElementById("g-hsn").value = g.hsn_code;
    document.getElementById("modal-garment").classList.add("open");
}

async function saveGarmentForm() {
    const payload = {
        id: document.getElementById("g-id").value || null,
        sku: document.getElementById("g-sku").value,
        barcode: document.getElementById("g-barcode").value,
        name: document.getElementById("g-name").value,
        category: document.getElementById("g-category").value,
        rack_location: document.getElementById("g-rack").value,
        size: document.getElementById("g-size").value,
        colour: document.getElementById("g-colour").value,
        fabric_type: document.getElementById("g-fabric").value,
        cost_price: document.getElementById("g-cost").value,
        selling_price: document.getElementById("g-price").value,
        stock_qty: document.getElementById("g-stock").value,
        min_stock_alert: document.getElementById("g-alert").value,
        hsn_code: document.getElementById("g-hsn").value,
    };
    if (!payload.sku || !payload.name) {
        alert("SKU and Garment Name are required.");
        return;
    }
    const res = await window.appAPI.saveGarment(payload);
    if (!res.ok) {
        alert("Error: " + res.error);
        return;
    }
    closeModal("modal-garment");
    await refreshAll();
}

async function submitMatrix() {
    const name = document.getElementById("mat-name").value.trim();
    if (!name) {
        alert("Please enter Garment Style Name.");
        return;
    }
    const sizes = Array.from(document.querySelectorAll("#mat-sizes input:checked")).map((i) => i.value);
    const colours = Array.from(document.querySelectorAll("#mat-colours input:checked")).map((i) => i.value);
    if (!sizes.length || !colours.length) {
        alert("Select at least one Size and one Colour.");
        return;
    }
    const res = await window.appAPI.generateMatrix({
        name,
        sku_prefix: document.getElementById("mat-prefix").value,
        category: document.getElementById("mat-category").value,
        rack_location: document.getElementById("mat-rack").value,
        hsn_code: document.getElementById("mat-hsn").value,
        cost_price: document.getElementById("mat-cost").value,
        selling_price: document.getElementById("mat-price").value,
        stock_qty: document.getElementById("mat-qty").value,
        sizes,
        colours,
    });
    if (!res.ok) {
        alert("Matrix error: " + res.error);
        return;
    }
    document.getElementById("mat-name").value = "";
    await refreshAll();
    switchView("view-inventory");
}

// ============================================================================
// 3. POS BILLING (FULLY EDITABLE DISCOUNT, CGST, SGST, PAYMENT & RECEIVED)
// ============================================================================
function renderPosGrid() {
    if (typeof renderPosLookup === "function") renderPosLookup();
    if (!document.getElementById("pos-items-grid")) return;
    const q = (document.getElementById("pos-scan")?.value || "").toLowerCase().trim();
    const cat = document.getElementById("pos-cat-select").value;

    const filtered = STATE.garments.filter((g) => {
        if (cat !== "ALL" && g.category !== cat) return false;
        if (q) {
            const hay = `${g.sku} ${g.barcode} ${g.name} ${g.colour} ${g.size}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    const grid = document.getElementById("pos-items-grid");
    grid.innerHTML = filtered
        .map((g) => {
            const gst = Number(g.selling_price) <= 2500 ? "5%" : "18%";
            const stClass = g.stock_qty <= 0 ? "badge-red" : g.stock_qty <= g.min_stock_alert ? "badge-amber" : "badge-green";
            const swatch = getGarmentColourHex(g.colour);
            return `
            <div class="item-tile" style="--tile-swatch:${swatch};" onclick="addGarmentToCart(${g.id})">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span class="tile-sku-chip mono">${escapeHtml(g.sku)}</span>
                    <span class="badge ${stClass}">${g.stock_qty} in stock</span>
                </div>
                <div style="font-weight:700;font-size:0.93rem;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(g.name)}">${escapeHtml(g.name)}</div>
                <div class="tile-variant-row">
                    <span class="tile-size-badge mono">Size ${escapeHtml(g.size)}</span>
                    <span style="display:inline-flex;align-items:center;gap:4px;">
                        <span class="swatch-dot" style="background:${swatch};"></span>
                        <span>${escapeHtml(g.colour)}</span>
                    </span>
                    <span style="margin-left:auto;font-size:0.74rem;color:#94A3B8;">${gst} GST</span>
                </div>
                <div class="tile-footer-row">
                    <span class="tile-price mono">${fmtINR(g.selling_price)}</span>
                    <span class="tile-add-pill">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        <span>Add</span>
                    </span>
                </div>
            </div>
        `;
        })
        .join("");
}

function onBarcodeKey(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = (e.target.value || "").trim().toLowerCase();
    if (!q) return;
    let match = STATE.garments.find((g) => g.barcode.toLowerCase() === q || g.sku.toLowerCase() === q);
    if (!match) {
        match = STATE.garments.find((g) => `${g.sku} ${g.name} ${g.size} ${g.colour}`.toLowerCase().includes(q));
    }
    if (match) {
        addGarmentToCart(match.id);
        e.target.value = "";
        closePosLookup();
        renderPosGrid();
    }
}

let phoneLookupTimer = null;
function onCustomerPhoneInput(phoneVal) {
    renderThermalPreview();
    clearTimeout(phoneLookupTimer);
    const clean = (phoneVal || "").trim();
    if (clean.length < 5) {
        STATE.matchedCustomer = null;
        return;
    }
    phoneLookupTimer = setTimeout(async () => {
        const res = await window.appAPI.findCustomerByPhone(clean);
        if (res && res.customer) {
            STATE.matchedCustomer = res.customer;
            if (document.getElementById("pos-name")) document.getElementById("pos-name").value = res.customer.full_name;
            if (document.getElementById("pos-city")) document.getElementById("pos-city").value = res.customer.city || "";
            renderThermalPreview();
        } else {
            STATE.matchedCustomer = null;
        }
    }, 150);
}

async function onCustomerFieldKey(e, field) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const val = (e.target && e.target.value ? e.target.value : "").trim();

    if (field === "phone") {
        const digits = val.replace(/\D/g, "");
        if (digits.length > 0 && digits.length < 10) {
            e.target.style.borderColor = "#B91C1C";
            setTimeout(() => { if (e.target) e.target.style.borderColor = ""; }, 650);
            e.target.focus();
            return;
        }
        if (digits.length >= 10) {
            clearTimeout(phoneLookupTimer);
            try {
                const res = await window.appAPI.findCustomerByPhone(val);
                if (res && res.customer) {
                    STATE.matchedCustomer = res.customer;
                    const nameEl = document.getElementById("pos-name");
                    const cityEl = document.getElementById("pos-city");
                    if (nameEl && !nameEl.value.trim()) nameEl.value = res.customer.full_name || "";
                    if (cityEl && !cityEl.value.trim()) cityEl.value = res.customer.city || "";
                    renderThermalPreview();
                }
            } catch (_) {}
        }
        const nameEl = document.getElementById("pos-name");
        if (nameEl) {
            nameEl.focus();
            nameEl.select();
        }
        return;
    }

    if (field === "name") {
        if (!val) return;
        const cityEl = document.getElementById("pos-city");
        if (cityEl) {
            cityEl.focus();
            cityEl.select();
        }
        return;
    }

    if (field === "city") {
        const recEl = document.getElementById("pos-received");
        const payEl = document.getElementById("pos-pay-mode");
        if (recEl && !recEl.disabled && recEl.offsetParent !== null) {
            recEl.focus();
            recEl.select();
        } else if (payEl) {
            payEl.focus();
        }
    }
}

function addGarmentToCart(id) {
    const g = STATE.garments.find((x) => Number(x.id) === Number(id));
    if (!g) return;
    STATE.lastBill = null;
    STATE.lastBillItems = null;

    const existing = STATE.cart.find((c) => Number(c.id) === Number(id));
    if (existing) {
        existing.qty += 1;
    } else {
        STATE.cart.push({ ...g, qty: 1, line_discount: 0 });
    }
    recalcCart();
}

function changeCartQty(id, delta) {
    const idx = STATE.cart.findIndex((c) => Number(c.id) === Number(id));
    if (idx === -1) return;
    STATE.cart[idx].qty += delta;
    if (STATE.cart[idx].qty <= 0) STATE.cart.splice(idx, 1);
    recalcCart();
}

function updateCartUnitPrice(id, val) {
    const item = STATE.cart.find((c) => Number(c.id) === Number(id));
    if (!item) return;
    item.selling_price = Math.max(0, Number(val || 0));
    recalcCart();
}

function removeCartLine(id) {
    STATE.cart = STATE.cart.filter((c) => Number(c.id) !== Number(id));
    recalcCart();
}

function clearCart() {
    STATE.cart = [];
    STATE.lastBill = null;
    STATE.lastBillItems = null;
    STATE.matchedCustomer = null;
    if (document.getElementById("pos-phone")) document.getElementById("pos-phone").value = "";
    if (document.getElementById("pos-name")) document.getElementById("pos-name").value = "";
    if (document.getElementById("pos-city")) document.getElementById("pos-city").value = "";
    if (document.getElementById("pos-discount")) document.getElementById("pos-discount").value = "0";
    if (document.getElementById("pos-received")) document.getElementById("pos-received").value = "";
    if (document.getElementById("pos-gst-rule")) document.getElementById("pos-gst-rule").value = "auto";
    if (document.getElementById("pos-cgst-rate")) document.getElementById("pos-cgst-rate").value = "2.5";
    if (document.getElementById("pos-sgst-rate")) document.getElementById("pos-sgst-rate").value = "2.5";
    if (document.getElementById("pos-igst")) document.getElementById("pos-igst").checked = false;
    if (document.getElementById("pos-credit-note")) document.getElementById("pos-credit-note").value = "";

    recalcCart();
}

function onGstRuleChange(ruleVal) {
    const cgstInput = document.getElementById("pos-cgst-rate");
    const sgstInput = document.getElementById("pos-sgst-rate");
    if (ruleVal === "5") {
        cgstInput.value = "2.5";
        sgstInput.value = "2.5";
    } else if (ruleVal === "12") {
        cgstInput.value = "6";
        sgstInput.value = "6";
    } else if (ruleVal === "18") {
        cgstInput.value = "9";
        sgstInput.value = "9";
    } else if (ruleVal === "0") {
        cgstInput.value = "0";
        sgstInput.value = "0";
    }
    recalcCart();
}

function onCustomTaxRateEdit() {
    document.getElementById("pos-gst-rule").value = "custom";
    recalcCart();
}

function onPaymentModeChange() {
    const mode = document.getElementById("pos-pay-mode").value;
    const splitRow = document.getElementById("pos-split-row");
    splitRow.style.display = mode === "Split" ? "grid" : "none";
    recalcCart();
}

function onSplitInput() {
    const cash = Number(document.getElementById("pos-split-cash").value || 0);
    const upi = Number(document.getElementById("pos-split-upi").value || 0);
    const card = Number(document.getElementById("pos-split-card").value || 0);
    document.getElementById("pos-received").value = String(cash + upi + card);
    recalcCart();
}

function calcGSTLine(unitPrice, qty, disc, taxMode, isIgst = false) {
    const rule = document.getElementById("pos-gst-rule")?.value || "auto";
    const customCgst = Number(document.getElementById("pos-cgst-rate")?.value || 0);
    const customSgst = Number(document.getElementById("pos-sgst-rate")?.value || 0);

    const gross = Math.max(0, unitPrice * qty - disc);
    const effUnit = qty > 0 ? gross / qty : unitPrice;
    let cgstRate, sgstRate, igstRate = 0, gstRate, taxable, cgst, sgst, igst = 0, total;

    if (rule === "auto") {
        // Indian Apparel GST Sept 2025/2026 slabs: <= 2500 ex-tax (or <= 2625 MRP incl) => 5%, above => 18%
        if (taxMode === "inclusive") {
            gstRate = effUnit <= 2625 ? 5 : 18;
        } else {
            gstRate = effUnit <= 2500 ? 5 : 18;
        }
        cgstRate = isIgst ? 0 : gstRate / 2;
        sgstRate = isIgst ? 0 : gstRate / 2;
        igstRate = isIgst ? gstRate : 0;
    } else {
        gstRate = +(customCgst + customSgst).toFixed(2);
        if (isIgst) {
            cgstRate = 0;
            sgstRate = 0;
            igstRate = gstRate;
        } else {
            cgstRate = customCgst;
            sgstRate = customSgst;
            igstRate = 0;
        }
    }

    if (taxMode === "inclusive") {
        taxable = +(gross / (1 + gstRate / 100)).toFixed(2);
        const totalTax = +(gross - taxable).toFixed(2);
        if (isIgst) {
            cgst = 0;
            sgst = 0;
            igst = totalTax;
        } else {
            cgst = +(taxable * (cgstRate / 100)).toFixed(2);
            sgst = +(totalTax - cgst).toFixed(2);
            igst = 0;
        }
        total = +gross.toFixed(2);
    } else {
        taxable = +gross.toFixed(2);
        if (isIgst) {
            cgst = 0;
            sgst = 0;
            igst = +(taxable * (igstRate / 100)).toFixed(2);
        } else {
            cgst = +(taxable * (cgstRate / 100)).toFixed(2);
            sgst = +(taxable * (sgstRate / 100)).toFixed(2);
            igst = 0;
        }
        total = +(taxable + cgst + sgst + igst).toFixed(2);
    }

    return { gstRate, cgstRate, sgstRate, igstRate, taxable, cgst, sgst, igst, total };
}

function allocateCartDiscounts() {
    const billDisc = Math.max(0, Number(document.getElementById("pos-discount")?.value || 0));
    const lineGrosses = STATE.cart.map((c) => Math.max(0, Number(c.selling_price) * Number(c.qty) - Number(c.line_discount || 0)));
    const grossSum = lineGrosses.reduce((a, b) => a + b, 0);
    return STATE.cart.map((c, idx) => {
        const extra = grossSum > 0 && billDisc > 0 ? +((lineGrosses[idx] / grossSum) * billDisc).toFixed(2) : 0;
        return Number(c.line_discount || 0) + extra;
    });
}

function recalcCart() {
    const tbody = document.getElementById("pos-cart-tbody");
    if (!tbody) return;
    const taxMode = document.getElementById("pos-tax-mode")?.value || "exclusive";
    const isIgst = Boolean(document.getElementById("pos-igst")?.checked);
    const allocDiscounts = allocateCartDiscounts();
    let subtotalSum = 0,
        taxableSum = 0,
        cgstSum = 0,
        sgstSum = 0,
        igstSum = 0,
        grandTotal = 0;

    if (!STATE.cart.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding:28px;color:var(--text-muted);">Type a garment name, SKU, size, or colour above (or click Browse All Stock) to start billing.</td></tr>`;
    } else {
        tbody.innerHTML = STATE.cart
            .map((c, idx) => {
                const t = calcGSTLine(Number(c.selling_price), c.qty, allocDiscounts[idx], taxMode, isIgst);
                subtotalSum += Number(c.selling_price) * c.qty;
                taxableSum += t.taxable;
                cgstSum += t.cgst;
                sgstSum += t.sgst;
                igstSum += t.igst;
                grandTotal += t.total;
                return `
                <tr>
                    <td class="mono"><strong>${escapeHtml(c.sku)}</strong></td>
                    <td><strong>${escapeHtml(c.name)}</strong></td>
                    <td class="text-center">${escapeHtml(c.size)} / ${escapeHtml(c.colour)}</td>
                    <td class="text-center">
                        <div style="display:inline-flex;align-items:center;gap:4px;">
                            <button type="button" class="btn btn-xs" onclick="changeCartQty(${c.id}, -1)">-</button>
                            <strong class="mono" style="min-width:18px;display:inline-block;">${c.qty}</strong>
                            <button type="button" class="btn btn-xs" onclick="changeCartQty(${c.id}, 1)">+</button>
                        </div>
                    </td>
                    <td class="text-right">
                        <input type="number" class="input mono text-right" style="width:90px;height:25px;" value="${c.selling_price}" onchange="updateCartUnitPrice(${c.id}, this.value)" />
                    </td>
                    <td class="text-center"><span class="badge badge-blue">${t.gstRate}%${isIgst ? " IGST" : ""}</span></td>
                    <td class="text-right mono"><strong>${fmtINR(t.total)}</strong></td>
                    <td class="text-right"><button type="button" class="btn btn-xs" onclick="removeCartLine(${c.id})">&times;</button></td>
                </tr>
            `;
            })
            .join("");
    }

    taxableSum = +taxableSum.toFixed(2);
    cgstSum = +cgstSum.toFixed(2);
    sgstSum = +sgstSum.toFixed(2);
    igstSum = +igstSum.toFixed(2);
    grandTotal = +grandTotal.toFixed(2);

    const recRaw = document.getElementById("pos-received")?.value ?? "";
    const receivedAmt = recRaw === "" ? grandTotal : Number(recRaw);
    const diff = +(receivedAmt - grandTotal).toFixed(2);

    document.getElementById("lbl-subtotal").textContent = fmtINR(subtotalSum);
    document.getElementById("lbl-taxable").textContent = fmtINR(taxableSum);
    const cgstWrap = document.getElementById("lbl-cgst-wrap");
    const sgstWrap = document.getElementById("lbl-sgst-wrap");
    if (isIgst) {
        if (cgstWrap) cgstWrap.innerHTML = `IGST: <strong id="lbl-cgst" class="mono">${fmtINR(igstSum)}</strong>`;
        if (sgstWrap) sgstWrap.innerHTML = `CGST/SGST: <strong id="lbl-sgst" class="mono">&#8377;0.00</strong>`;
    } else {
        if (cgstWrap) cgstWrap.innerHTML = `CGST: <strong id="lbl-cgst" class="mono">${fmtINR(cgstSum)}</strong>`;
        if (sgstWrap) sgstWrap.innerHTML = `SGST: <strong id="lbl-sgst" class="mono">${fmtINR(sgstSum)}</strong>`;
    }
    document.getElementById("lbl-grand").textContent = fmtINR(grandTotal);
    const cntEl = document.getElementById("pos-total-items-count");
    if (cntEl) cntEl.textContent = String(STATE.cart.reduce((n, item) => n + Number(item.qty || 1), 0));

    const changeWrap = document.getElementById("lbl-change-wrap");
    if (diff >= 0) {
        changeWrap.style.color = "var(--green)";
        changeWrap.innerHTML = `Change to Return: <strong id="lbl-change" class="mono">${fmtINR(diff)}</strong>`;
    } else {
        changeWrap.style.color = "var(--red)";
        changeWrap.innerHTML = `Balance Due: <strong id="lbl-change" class="mono">${fmtINR(Math.abs(diff))}</strong>`;
    }

    renderThermalPreview();
}

function setThermalRoll(widthVal) {
    const el = document.getElementById("thermal-paper") || document.getElementById("erp-receipt-paper-host");
    if (!el) return;
    if (widthVal === "58mm") el.classList.add("roll-58mm");
    else el.classList.remove("roll-58mm");
}

function renderThermalPreview() {
    if (window.APP_INTERFACE === "erp" && !STATE.lastBill) return;
    const s = STATE.settings || {};
    const paper = document.getElementById("thermal-paper") || document.getElementById("erp-receipt-paper-host");
    if (!paper) return;

    const isDone = Boolean(STATE.lastBill);
    const billNo = isDone ? STATE.lastBill.bill_no : STATE.next_bill_no;
    const dtStr = isDone ? fmtDate(STATE.lastBill.created_at) : fmtDate(new Date());
    const custName = isDone ? STATE.lastBill.customer_name : document.getElementById("pos-name")?.value || "Walk-in Customer";
    const custPhone = isDone ? STATE.lastBill.customer_phone : document.getElementById("pos-phone")?.value || "";
    const payMode = isDone ? STATE.lastBill.payment_mode : document.getElementById("pos-pay-mode")?.value || "Cash";
    const taxMode = isDone ? STATE.lastBill.tax_mode : document.getElementById("pos-tax-mode")?.value || s.tax_mode || "exclusive";
    const isIgst = isDone ? Boolean(STATE.lastBill.is_igst) : Boolean(document.getElementById("pos-igst")?.checked);
    const cnUsed = isDone ? (STATE.lastBill.credit_note_used || "") : (document.getElementById("pos-credit-note")?.value || "").trim();

    let linesHtml = "";
    let subtotal = 0,
        taxableSum = 0,
        cgstSum = 0,
        sgstSum = 0,
        igstSum = 0,
        grandTotal = 0,
        totalQty = 0;

    if (isDone && STATE.lastBillItems) {
        STATE.lastBillItems.forEach((item) => {
            totalQty += Number(item.qty);
            linesHtml += `
                <div style="margin:3px 0;">
                    <div class="r-bold">${escapeHtml(item.garment_name)} (${escapeHtml(item.size)}/${escapeHtml(item.colour)})</div>
                    <div class="r-row">
                        <span>${escapeHtml(item.sku)} | ${item.qty} x ${Number(item.unit_price).toFixed(2)}</span>
                        <span class="r-bold">${Number(item.line_total).toFixed(2)}</span>
                    </div>
                </div>
            `;
        });
        subtotal = Number(STATE.lastBill.subtotal);
        taxableSum = Number(STATE.lastBill.taxable_amount);
        cgstSum = Number(STATE.lastBill.cgst_amount);
        sgstSum = Number(STATE.lastBill.sgst_amount);
        igstSum = Number(STATE.lastBill.igst_amount || 0);
        grandTotal = Number(STATE.lastBill.grand_total);
    } else {
        const allocDiscounts = allocateCartDiscounts();
        STATE.cart.forEach((c, idx) => {
            const t = calcGSTLine(Number(c.selling_price), c.qty, allocDiscounts[idx], taxMode, isIgst);
            subtotal += Number(c.selling_price) * c.qty;
            taxableSum += t.taxable;
            cgstSum += t.cgst;
            sgstSum += t.sgst;
            igstSum += t.igst;
            grandTotal += t.total;
            totalQty += c.qty;
            linesHtml += `
                <div style="margin:3px 0;">
                    <div class="r-bold">${escapeHtml(c.name)} (${escapeHtml(c.size)}/${escapeHtml(c.colour)})</div>
                    <div class="r-row">
                        <span>${escapeHtml(c.sku)} | ${c.qty} x ${Number(c.selling_price).toFixed(2)} (${t.gstRate}%)</span>
                        <span class="r-bold">${t.total.toFixed(2)}</span>
                    </div>
                </div>
            `;
        });
        taxableSum = +taxableSum.toFixed(2);
        cgstSum = +cgstSum.toFixed(2);
        sgstSum = +sgstSum.toFixed(2);
        igstSum = +igstSum.toFixed(2);
        grandTotal = +grandTotal.toFixed(2);
    }

    const discVal = isDone ? Number(STATE.lastBill.discount_amount) : Number(document.getElementById("pos-discount")?.value || 0);
    const recRaw = document.getElementById("pos-received")?.value ?? "";
    const recVal = isDone ? Number(STATE.lastBill.amount_received) : (recRaw === "" ? grandTotal : Number(recRaw));
    const changeVal = isDone ? Number(STATE.lastBill.change_returned) : Math.max(0, +(recVal - grandTotal).toFixed(2));

    const wmText = (localStorage.getItem("pos_receipt_watermark") || s.store_name || "SHOWROOM").trim();
    paper.innerHTML = `
        <div class="thermal-watermark">${escapeHtml(wmText)}</div>
        <div class="thermal-content-layer">
        <div class="r-center">
            <div class="r-bold" style="font-size:14px;">${escapeHtml(s.store_name || "TAX INVOICE")}</div>
            <div style="font-size:9.5px;">${escapeHtml(s.address_line1 || "")}</div>
            <div style="font-size:9.5px;">${escapeHtml(s.address_line2 || "")}</div>
            <div style="font-size:9.5px;">Tel: ${escapeHtml(s.phone || "")}</div>
            <div class="r-bold" style="font-size:10px;">GSTIN: ${escapeHtml(s.gstin || "")}</div>
        </div>
        <div class="r-dline"></div>
        <div class="r-center r-bold">TAX INVOICE (${escapeHtml(taxMode.toUpperCase())})</div>
        <div class="r-line"></div>
        <div class="r-row"><span>Bill: <b>${escapeHtml(billNo)}</b></span><span>Mode: <b>${escapeHtml(payMode)}</b></span></div>
        <div class="r-row"><span>Date: ${escapeHtml(dtStr)}</span></div>
        <div class="r-row"><span>Customer: <b>${escapeHtml(custName)}</b></span></div>
        ${custPhone ? `<div class="r-row"><span>Mobile: ${escapeHtml(custPhone)}</span></div>` : ""}
        <div class="r-line"></div>
        <div class="r-row r-bold"><span>ITEM / SKU / QTY x RATE</span><span>AMT (₹)</span></div>
        <div class="r-line"></div>
        ${linesHtml || `<div class="r-center" style="padding:14px 0;color:#666;">[ Add Garments to Preview Bill ]</div>`}
        <div class="r-line"></div>
        <div class="r-row"><span>Total Qty:</span><span>${totalQty} pcs</span></div>
        <div class="r-row"><span>Subtotal:</span><span>${fmtINR(subtotal)}</span></div>
        ${discVal > 0 ? `<div class="r-row"><span>Discount:</span><span>-${fmtINR(discVal)}</span></div>` : ""}
        <div class="r-row"><span>Taxable Value:</span><span>${fmtINR(taxableSum)}</span></div>
        ${isIgst ? `<div class="r-row"><span>IGST:</span><span>${fmtINR(igstSum)}</span></div>` : `<div class="r-row"><span>CGST:</span><span>${fmtINR(cgstSum)}</span></div><div class="r-row"><span>SGST:</span><span>${fmtINR(sgstSum)}</span></div>`}
        ${cnUsed ? `<div class="r-row"><span>Credit Note (${escapeHtml(cnUsed)}):</span><span>Applied</span></div>` : ""}
        <div class="r-dline"></div>
        <div class="r-row r-bold" style="font-size:13px;">
            <span>GRAND TOTAL:</span>
            <span>${fmtINR(grandTotal)}</span>
        </div>
        <div class="r-row"><span>Received:</span><span>${fmtINR(recVal)}</span></div>
        ${changeVal > 0 ? `<div class="r-row"><span>Change Returned:</span><span>${fmtINR(changeVal)}</span></div>` : ""}
        <div class="r-dline"></div>
        <div class="r-center" style="font-size:9px;margin-top:4px;">
            ${escapeHtml(s.footer_note || "")}
        </div>
        <div class="r-center" style="margin-top:6px;">
            <svg id="thermal-bill-barcode"></svg>
        </div>
        </div>
    `;
    if (typeof JsBarcode !== "undefined") {
        try {
            JsBarcode("#thermal-bill-barcode", String(billNo || "INV-00001"), {
                format: "CODE128",
                lineColor: "#000000",
                width: 1.35,
                height: 32,
                displayValue: true,
                fontSize: 10,
                margin: 2,
            });
        } catch (_) {}
    }
}

async function submitBillCheckout() {
    if (!STATE.cart.length) {
        alert("Please add at least one garment to the bill.");
        return;
    }
    const gstRule = document.getElementById("pos-gst-rule").value;
    const payload = {
        customer_phone: document.getElementById("pos-phone").value,
        customer_name: document.getElementById("pos-name").value,
        customer_city: document.getElementById("pos-city").value,
        payment_mode: document.getElementById("pos-pay-mode").value,
        tax_mode: document.getElementById("pos-tax-mode").value,
        bill_discount: document.getElementById("pos-discount").value,
        amount_received: document.getElementById("pos-received").value,
        custom_gst_enabled: gstRule !== "auto",
        custom_cgst_rate: document.getElementById("pos-cgst-rate").value,
        custom_sgst_rate: document.getElementById("pos-sgst-rate").value,
        is_igst: Boolean(document.getElementById("pos-igst")?.checked),
        credit_note_no: (document.getElementById("pos-credit-note")?.value || "").trim(),
        cash_paid: document.getElementById("pos-split-cash").value,
        upi_paid: document.getElementById("pos-split-upi").value,
        card_paid: document.getElementById("pos-split-card").value,
        items: STATE.cart,
    };
    const res = await window.appAPI.checkoutBill(payload);
    if (!res.ok) {
        alert("Checkout Error: " + res.error);
        return;
    }
    STATE.lastBill = res.bill;
    STATE.lastBillItems = res.items;
    STATE.cart = [];
    await refreshAll();
    renderThermalPreview();
    triggerThermalPrint();
    if (res.notifications && res.notifications.waLinkUrl) {
        window.open(res.notifications.waLinkUrl, "_blank");
    }
}

async function reprintBill(billId) {
    const res = await window.appAPI.getBillDetail(billId);
    if (!res || !res.ok || !res.bill) return;
    STATE.lastBill = res.bill;
    STATE.lastBillItems = res.items;
    renderThermalPreview();
    if (window.APP_INTERFACE === "pos") {
        closeModal("modal-recent-bills");
        openPosReceiptModal();
    } else {
        const host = document.getElementById("erp-receipt-paper-host");
        const modal = document.getElementById("modal-erp-receipt");
        if (host && modal) {
            host.classList.add("thermal-paper");
            setThermalRoll((STATE.settings && STATE.settings.thermal_width) || "80mm");
            modal.classList.add("open");
        }
    }
}

function triggerThermalPrint(silentOverride) {
    const opts = {};
    if (silentOverride !== undefined) opts.silent = Boolean(silentOverride);
    window.appAPI.printThermal(opts);
}

async function saveCurrentReceiptPdf() {
    const billNo = STATE.lastBill ? STATE.lastBill.bill_no : STATE.next_bill_no;
    const res = await window.appAPI.saveReceiptPdf(billNo);
    if (res && res.ok) {
        alert("Receipt PDF saved to:\n" + res.pdfPath);
    }
}

function printGarmentTag(id) {
    const g = STATE.garments.find((x) => Number(x.id) === Number(id));
    if (!g) return;
    const host = document.getElementById("thermal-paper") || document.getElementById("erp-receipt-paper-host");
    if (!host) return;
    const oldHtml = host.innerHTML;
    host.innerHTML = `
        <div class="thermal-paper" style="margin:0 auto;border:2px solid #000;padding:10px;text-align:center;">
            <div class="r-bold" style="font-size:13px;">${g.name}</div>
            <div class="r-line"></div>
            <div style="font-size:11px;margin:4px 0;">SIZE: <b>${g.size}</b> &nbsp;|&nbsp; COL: <b>${g.colour}</b></div>
            <div style="font-size:10px;">SKU: <b>${g.sku}</b> &nbsp;|&nbsp; RACK: ${g.rack_location || "—"}</div>
            <div style="margin:6px 0;"><svg id="garment-tag-barcode"></svg></div>
            <div class="r-dline"></div>
            <div style="font-size:14px;font-weight:900;">PRICE: ${fmtINR(g.selling_price)}</div>
        </div>
    `;
    if (typeof JsBarcode !== "undefined") {
        try {
            JsBarcode("#garment-tag-barcode", String(g.barcode || g.sku), {
                format: "CODE128",
                width: 1.5,
                height: 36,
                displayValue: true,
                fontSize: 10,
                margin: 2,
            });
        } catch (_) {}
    }
    const erpModal = document.getElementById("modal-erp-receipt");
    if (erpModal) {
        erpModal.classList.add("open");
    } else {
        const restoreHost = () => {
            host.innerHTML = oldHtml;
            window.removeEventListener("afterprint", restoreHost);
        };
        window.addEventListener("afterprint", restoreHost);
        window.appAPI.printThermal({ silent: false });
        setTimeout(restoreHost, 15000);
    }
}

// ============================================================================
// 4. 100,000+ CUSTOMERS DIRECTORY & COMPLETE PURCHASE HISTORY INSPECTOR
// ============================================================================
async function searchCustomers(page = 1) {
    const query = document.getElementById("cust-search-input").value || "";
    const sortBy = document.getElementById("cust-sort-select").value || "recent";
    const res = await window.appAPI.listCustomers({ query, page, pageSize: 50, sortBy });
    if (!res || !res.ok) return;

    STATE.custRows = res.rows || [];
    STATE.custTotal = res.totalCount || 0;
    STATE.custPage = res.page || 1;
    STATE.custTotalPages = res.totalPages || 1;

    document.getElementById("cust-pagination-info").textContent = `Page ${STATE.custPage} of ${STATE.custTotalPages} — Total: ${STATE.custTotal.toLocaleString("en-IN")} Customers`;
    document.getElementById("btn-cust-prev").disabled = STATE.custPage <= 1;
    document.getElementById("btn-cust-next").disabled = STATE.custPage >= STATE.custTotalPages;

    const tbody = document.getElementById("cust-directory-tbody");
    if (!STATE.custRows.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding:28px;color:var(--text-muted);">No matching customers found. Customers are automatically created whenever you enter their mobile number during billing, or click "+ New Customer".</td></tr>`;
        return;
    }

    tbody.innerHTML = STATE.custRows
        .map((c) => {
            const isSel = STATE.selectedCustomer && Number(STATE.selectedCustomer.id) === Number(c.id);
            return `
            <tr class="${isSel ? "selected-row" : ""}" style="cursor:pointer;" onclick="inspectCustomer(${c.id})">
                <td class="mono"><strong>${c.customer_code}</strong></td>
                <td><strong>${c.full_name}</strong></td>
                <td class="mono">${c.phone}</td>
                <td>${c.city || "—"}</td>
                <td class="text-center"><span class="badge badge-blue">${c.total_visits}</span></td>
                <td class="text-center mono">${c.total_items_bought}</td>
                <td class="text-right mono"><strong>${fmtINR(c.total_spent)}</strong></td>
                <td class="mono" style="font-size:0.84rem;color:var(--text-muted);">${fmtDate(c.last_purchase_at)}</td>
            </tr>
        `;
        })
        .join("");
}

function changeCustomerPage(delta) {
    const next = STATE.custPage + delta;
    if (next < 1 || next > STATE.custTotalPages) return;
    searchCustomers(next);
}

async function inspectCustomer(customerId) {
    const res = await window.appAPI.getCustomerHistory(customerId);
    if (!res || !res.ok || !res.customer) return;

    const c = res.customer;
    STATE.selectedCustomer = c;
    document.getElementById("cust-detail-header").textContent = `${c.full_name} (${c.customer_code})`;
    document.getElementById("btn-edit-selected-cust").style.display = "inline-flex";

    searchCustomers(STATE.custPage);

    const billsHtml = (res.bills || [])
        .map(
            (b) => `
        <tr>
            <td class="mono"><strong>${b.bill_no}</strong></td>
            <td class="mono" style="font-size:0.84rem;">${fmtDate(b.created_at)}</td>
            <td><span class="badge badge-blue">${b.payment_mode}</span></td>
            <td class="text-center mono">${b.total_qty}</td>
            <td class="text-right mono"><strong>${fmtINR(b.grand_total)}</strong></td>
            <td class="text-right">
                <div style="display:inline-flex;gap:4px;">
                    <button type="button" class="btn btn-xs btn-dark" onclick="reprintBill(${b.id})">Receipt</button>
                    ${b.customer_phone ? `<button type="button" class="btn btn-xs" onclick="resendBillMsg('${b.bill_no}')">Send Msg</button>` : ""}
                </div>
            </td>
        </tr>
    `
        )
        .join("");

    const itemsHtml = (res.purchased_items || [])
        .map(
            (it) => `
        <tr>
            <td class="mono">${it.bill_no}</td>
            <td class="mono"><strong>${it.sku}</strong></td>
            <td><strong>${it.garment_name}</strong> (${it.size} / ${it.colour})</td>
            <td class="text-center mono">${it.qty}</td>
            <td class="text-right mono">${fmtINR(it.line_total)}</td>
        </tr>
    `
        )
        .join("");

    const vipThreshold = Number(localStorage.getItem("biz_vip_threshold") || 25000);
    const isVip = Number(c.total_spent || 0) >= vipThreshold;
    const avgBill = Number(c.total_visits || 0) > 0 ? Number(c.total_spent || 0) / Number(c.total_visits) : 0;
    const catFreq = {};
    const sizeFreq = {};
    (res.purchased_items || []).forEach((it) => {
        if (it.category) catFreq[it.category] = (catFreq[it.category] || 0) + Number(it.qty || 1);
        if (it.size) sizeFreq[it.size] = (sizeFreq[it.size] || 0) + Number(it.qty || 1);
    });
    const prefCat = Object.entries(catFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
    const prefSize = Object.entries(sizeFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

    document.getElementById("cust-detail-body").innerHTML = `
        <div style="background:#F8FAFC;border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                <div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:1.15rem;font-weight:800;">${c.full_name}</span>
                        ${isVip ? `<span class="badge badge-amber">VIP CLIENT</span>` : `<span class="badge badge-blue">REGULAR</span>`}
                    </div>
                    <div class="mono" style="font-size:0.92rem;color:#525252;margin-top:2px;">Phone: ${c.phone} &bull; Code: ${c.customer_code}</div>
                    <div style="font-size:0.88rem;color:var(--text-secondary);margin-top:4px;">
                        City: <b>${c.city || "—"}</b> &bull; Address: ${c.address || "—"}
                        ${c.gstin ? ` &bull; GSTIN: <span class="mono">${c.gstin}</span>` : ""}
                    </div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:0.8rem;font-weight:700;color:var(--text-muted);">LIFETIME SPEND</div>
                    <div class="mono" style="font-size:1.35rem;font-weight:800;color:#0A0A0A;">${fmtINR(c.total_spent)}</div>
                    <div style="font-size:0.85rem;color:var(--text-secondary);">${c.total_visits} Visits &bull; ${c.total_items_bought} Garments</div>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid #E2E8F0;font-size:0.82rem;">
                <div><span style="color:#64748B;">Avg Bill:</span> <strong class="mono">${fmtINR(avgBill)}</strong></div>
                <div><span style="color:#64748B;">Fav Category:</span> <strong>${prefCat}</strong></div>
                <div><span style="color:#64748B;">Pref Size:</span> <strong class="mono">${prefSize}</strong></div>
                <div style="text-align:right;"><button type="button" class="btn btn-xs btn-dark" onclick="openCustomerWhatsApp('${c.phone}', '${(c.full_name || "").replace(/'/g, "")}')">Open WhatsApp</button></div>
            </div>
        </div>

        <div style="font-size:0.88rem;font-weight:700;text-transform:uppercase;color:var(--text-secondary);margin-bottom:6px;">
            Customer Bills History (${(res.bills || []).length})
        </div>
        <div style="border:1px solid var(--border);border-radius:5px;max-height:175px;overflow-y:auto;margin-bottom:14px;">
            <table class="data-grid">
                <thead>
                    <tr>
                        <th>Bill No</th>
                        <th>Date</th>
                        <th>Mode</th>
                        <th class="text-center">Qty</th>
                        <th class="text-right">Amount</th>
                        <th class="text-right">Action</th>
                    </tr>
                </thead>
                <tbody>${billsHtml || `<tr><td colspan="6" class="text-center" style="padding:14px;">No bills yet.</td></tr>`}</tbody>
            </table>
        </div>

        <div style="font-size:0.88rem;font-weight:700;text-transform:uppercase;color:var(--text-secondary);margin-bottom:6px;">
            Every Garment Purchased by This Customer (${(res.purchased_items || []).length})
        </div>
        <div style="border:1px solid var(--border);border-radius:5px;max-height:210px;overflow-y:auto;">
            <table class="data-grid">
                <thead>
                    <tr>
                        <th>Bill</th>
                        <th>SKU</th>
                        <th>Garment (Size / Colour)</th>
                        <th class="text-center">Qty</th>
                        <th class="text-right">Total</th>
                    </tr>
                </thead>
                <tbody>${itemsHtml || `<tr><td colspan="5" class="text-center" style="padding:14px;">No items purchased yet.</td></tr>`}</tbody>
            </table>
        </div>
    `;
}

function openCustomerModal() {
    document.getElementById("modal-customer-title").textContent = "Add New Customer Profile";
    document.getElementById("c-id").value = "";
    document.getElementById("c-name").value = "";
    document.getElementById("c-phone").value = "";
    document.getElementById("c-city").value = "";
    document.getElementById("c-email").value = "";
    document.getElementById("c-gstin").value = "";
    document.getElementById("c-address").value = "";
    document.getElementById("c-notes").value = "";
    document.getElementById("modal-customer").classList.add("open");
}

function editSelectedCustomer() {
    const c = STATE.selectedCustomer;
    if (!c) return;
    document.getElementById("modal-customer-title").textContent = `Edit Customer: ${c.customer_code}`;
    document.getElementById("c-id").value = c.id;
    document.getElementById("c-name").value = c.full_name;
    document.getElementById("c-phone").value = c.phone;
    document.getElementById("c-city").value = c.city || "";
    document.getElementById("c-email").value = c.email || "";
    document.getElementById("c-gstin").value = c.gstin || "";
    document.getElementById("c-address").value = c.address || "";
    document.getElementById("c-notes").value = c.notes || "";
    document.getElementById("modal-customer").classList.add("open");
}

async function saveCustomerForm() {
    const payload = {
        id: document.getElementById("c-id").value || null,
        full_name: document.getElementById("c-name").value,
        phone: document.getElementById("c-phone").value,
        city: document.getElementById("c-city").value,
        email: document.getElementById("c-email").value,
        gstin: document.getElementById("c-gstin").value,
        address: document.getElementById("c-address").value,
        notes: document.getElementById("c-notes").value,
    };
    const res = await window.appAPI.saveCustomer(payload);
    if (!res.ok) {
        alert("Error: " + res.error);
        return;
    }
    closeModal("modal-customer");
    await refreshAll();
    await searchCustomers(1);
    if (res.customer) inspectCustomer(res.customer.id);
}

// ============================================================================
// 5. AUTH, DUAL-DB FAILOVER, PRINTER MODE & AUTOMATIONS
// ============================================================================
function showPinLogin() {
    const ov = document.getElementById("pin-login-overlay");
    if (ov) ov.classList.add("open");
    setTimeout(() => {
        const inp = document.getElementById("login-pin-input");
        if (inp) inp.focus();
    }, 60);
}

async function submitPinLogin() {
    const pin = document.getElementById("login-pin-input").value.trim();
    const errEl = document.getElementById("login-pin-error");
    errEl.style.display = "none";
    const res = await window.appAPI.login(pin);
    if (!res.ok) {
        errEl.textContent = res.error || "Incorrect PIN";
        errEl.style.display = "block";
        return;
    }
    document.getElementById("login-pin-input").value = "";
    document.getElementById("pin-login-overlay").classList.remove("open");
    await refreshAll();
    switchView("view-dashboard");
}

async function logoutSession() {
    await window.appAPI.logout();
    showPinLogin();
}

function switchSettingsTab(tabId) {
    document.querySelectorAll(".settings-tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".settings-tab-pane").forEach((p) => p.classList.remove("active"));
    const btn = document.querySelector(`.settings-tab[data-stab="${tabId}"]`);
    const pane = document.getElementById(tabId);
    if (btn) btn.classList.add("active");
    if (pane) pane.classList.add("active");
}

function openSettingsTab(tabId) {
    if (window.APP_INTERFACE === "pos") {
        openPosSettingsDrawer(tabId);
        return;
    }
    switchView("view-settings");
    switchSettingsTab(tabId);
}

function updatePrinterPill() {
    const pill = document.getElementById("pos-printer-pill");
    const mode = (STATE.automations && STATE.automations.printer_mode) || "browser";
    if (!pill) return;
    if (mode === "rawbt") {
        pill.className = "printer-pill online";
        pill.innerHTML = "&#9679; Android RawBT";
    } else {
        pill.className = "printer-pill online";
        pill.innerHTML = "&#9679; Print Ready";
    }
}

function printTestReceipt() {
    const paper = document.getElementById("thermal-paper");
    const oldHtml = paper.innerHTML;
    const s = STATE.settings || {};
    const wmText = (localStorage.getItem("pos_receipt_watermark") || s.store_name || "SHOWROOM").trim();
    paper.innerHTML = `
        <div class="thermal-watermark">${wmText}</div>
        <div class="thermal-content-layer">
        <div class="r-center">
            <div class="r-bold" style="font-size:14px;">${s.store_name || "SHOWROOM POS"}</div>
            <div class="r-line"></div>
            <div class="r-bold">THERMAL PRINTER TEST</div>
            <div class="r-line"></div>
            <div>Date: ${fmtDate(new Date())}</div>
            <div>Roll Width: ${s.thermal_width || "80mm"}</div>
            <div>Status: READY FOR LIVE BILLING</div>
            <div class="r-dline"></div>
        </div>
    `;
    const restorePaper = () => {
        paper.innerHTML = oldHtml;
        window.removeEventListener("afterprint", restorePaper);
    };
    window.addEventListener("afterprint", restorePaper);
    window.appAPI.printThermal();
    setTimeout(restorePaper, 15000);
}

function toggleWhatsappModeFields() {
    const mode = document.getElementById("auto-wa-mode")?.value || "wa_link";
    document.querySelectorAll(".wa-api-field").forEach((el) => { el.style.display = mode === "webhook" ? "flex" : "none"; });
    document.querySelectorAll(".wa-cloud-field").forEach((el) => { el.style.display = mode === "cloud_api" ? "flex" : "none"; });
    document.querySelectorAll(".wa-token-field").forEach((el) => { el.style.display = mode === "cloud_api" || mode === "webhook" ? "flex" : "none"; });
}

function renderDualDbStatus() {
    const d = STATE.dual_db;
    if (!d) return;

    function fillCard(prefix, info) {
        const badge = document.getElementById(`db-${prefix}-badge`);
        const sizeEl = document.getElementById(`db-${prefix}-size`);
        const latEl = document.getElementById(`db-${prefix}-lat`);
        const barEl = document.getElementById(`db-${prefix}-bar`);
        const cntEl = document.getElementById(`db-${prefix}-counts`);
        if (!badge || !info) return;

        if (!info.configured) {
            badge.className = "badge badge-amber";
            badge.textContent = "NOT CONFIGURED";
            sizeEl.textContent = "—";
            latEl.textContent = "—";
            barEl.style.width = "0%";
            cntEl.textContent = "Add environment variable in Vercel Project Settings.";
            return;
        }
        if (!info.online) {
            badge.className = "badge badge-red";
            badge.textContent = "OFFLINE";
            sizeEl.textContent = "—";
            latEl.textContent = `${info.latency_ms || 0} ms`;
            barEl.style.width = "0%";
            cntEl.textContent = info.error || "Connection failed";
            return;
        }
        badge.className = info.usage_pct >= 85 ? "badge badge-amber" : "badge badge-green";
        badge.textContent = info.status;
        sizeEl.textContent = `${info.size_mb} MB / ${info.max_mb} MB (${info.usage_pct}%)`;
        latEl.textContent = `${info.latency_ms} ms`;
        barEl.style.width = `${Math.max(4, info.usage_pct)}%`;
        const c = info.counts || {};
        cntEl.textContent = `Garments: ${c.garments || 0} • Customers: ${c.customers || 0} • Bills: ${c.bills || 0} • Ledger: ${c.ledger_rows || 0}`;
    }

    fillCard("prim", d.primary);
    fillCard("sec", d.secondary);
}

async function runSyncSecondary() {
    const btn = document.getElementById("btn-sync-sec");
    if (btn) { btn.disabled = true; btn.textContent = "Mirroring..."; }
    const res = await window.appAPI.syncSecondary();
    if (btn) { btn.disabled = false; btn.textContent = "Mirror Primary → Secondary"; }
    if (res && res.ok) {
        await refreshAll();
        alert(`Mirrored successfully to Secondary DB!\nGarments: ${res.synced.garments}, Customers: ${res.synced.customers}, Bills: ${res.synced.bills}`);
    } else {
        alert("Mirror failed: " + (res?.error || "Unknown error"));
    }
}

async function runArchiveExcess() {
    const days = Number(document.getElementById("archive-days")?.value || 90);
    if (!confirm(`Archive all bills, ledger & logs older than ${days} days to Secondary DB and free space in Primary DB?`)) return;
    const btn = document.getElementById("btn-archive-sec");
    if (btn) { btn.disabled = true; btn.textContent = "Archiving..."; }
    const res = await window.appAPI.archiveExcess(days);
    if (btn) { btn.disabled = false; btn.textContent = "Archive Excess to Secondary"; }
    if (res && res.ok) {
        await refreshAll();
        alert(`Excess data safely archived to Secondary DB!\nFreed from Primary — Bills: ${res.freed_from_primary.bills}, Ledger: ${res.freed_from_primary.stock_ledger}, Logs: ${res.freed_from_primary.notification_logs}`);
    } else {
        alert("Archive failed: " + (res?.error || "Unknown error"));
    }
}

function renderAutomationsAndLogs() {
    const a = STATE.automations || {};
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ""; };
    const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = Boolean(v); };

    setVal("auto-printer-mode", a.printer_mode || "browser");
    setChk("auto-wa-enabled", a.whatsapp_enabled);
    setVal("auto-wa-mode", a.whatsapp_mode || "wa_link");
    setVal("auto-wa-url", a.whatsapp_api_url || "");
    setVal("auto-wa-phone-id", a.whatsapp_phone_number_id || "");
    setVal("auto-wa-token", a.whatsapp_api_token || "");
    setVal("auto-wa-template", a.whatsapp_template || "");

    setChk("auto-sms-enabled", a.sms_enabled);
    setVal("auto-sms-provider", a.sms_provider || "fast2sms");
    setVal("auto-sms-sender", a.sms_sender_id || "");
    setVal("auto-sms-key", a.sms_api_key || "");
    setVal("auto-sms-template", a.sms_template || "");

    toggleWhatsappModeFields();

    const tbody = document.getElementById("notif-log-tbody");
    if (tbody) {
        if (!STATE.notification_logs.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding:18px;color:var(--text-muted);">No WhatsApp or SMS notifications sent yet.</td></tr>`;
        } else {
            tbody.innerHTML = STATE.notification_logs.map((n) => {
                const cls = n.status === "SENT" || n.status === "READY_WA_LINK" ? "badge-green" : n.status === "FAILED" ? "badge-red" : "badge-amber";
                return `
                    <tr>
                        <td class="mono" style="font-size:0.82rem;color:var(--text-muted);">${fmtDate(n.created_at)}</td>
                        <td class="mono"><strong>${escapeHtml(n.bill_no || "—")}</strong></td>
                        <td><span class="badge badge-blue">${escapeHtml(n.channel)}</span></td>
                        <td class="mono">${escapeHtml(n.customer_phone || "—")}</td>
                        <td><span class="badge ${cls}">${escapeHtml(n.status)}</span></td>
                        <td style="font-size:0.82rem;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(n.provider_response || "")}">${escapeHtml(n.provider_response || "—")}</td>
                        <td class="text-right">
                            ${n.bill_no ? `<button type="button" class="btn btn-xs" onclick="resendBillMsg('${escapeHtml(n.bill_no)}')">Resend</button>` : ""}
                        </td>
                    </tr>
                `;
            }).join("");
        }
    }
}

async function saveAutomationForm() {
    const payload = {
        printer_mode: document.getElementById("auto-printer-mode")?.value || "browser",
        whatsapp_enabled: Boolean(document.getElementById("auto-wa-enabled")?.checked),
        whatsapp_mode: document.getElementById("auto-wa-mode")?.value || "wa_link",
        whatsapp_api_url: document.getElementById("auto-wa-url")?.value || "",
        whatsapp_phone_number_id: document.getElementById("auto-wa-phone-id")?.value || "",
        whatsapp_api_token: document.getElementById("auto-wa-token")?.value || "",
        whatsapp_template: document.getElementById("auto-wa-template")?.value || "",
        sms_enabled: Boolean(document.getElementById("auto-sms-enabled")?.checked),
        sms_provider: document.getElementById("auto-sms-provider")?.value || "fast2sms",
        sms_sender_id: document.getElementById("auto-sms-sender")?.value || "",
        sms_api_key: document.getElementById("auto-sms-key")?.value || "",
        sms_template: document.getElementById("auto-sms-template")?.value || "",
    };
    const res = await window.appAPI.saveAutomationSettings(payload);
    if (res && res.ok) {
        await refreshAll();
        alert("Settings saved successfully.");
    } else if (res && res.error) {
        alert("Save error: " + res.error);
    }
}

async function resendBillMsg(billNo) {
    const res = await window.appAPI.resendBillNotifications(billNo);
    await refreshAll();
    if (!res || !res.ok) {
        alert("Could not send message: " + (res?.error || "Unknown error"));
        return;
    }
    if (res.waLinkUrl) {
        window.open(res.waLinkUrl, "_blank");
        return;
    }
    if (!res.results || !res.results.length) {
        alert("Enable WhatsApp or Mobile SMS in Settings -> WhatsApp & SMS first, and ensure the bill has a customer mobile number.");
        return;
    }
    const summary = res.results.map((r) => `${r.channel}: ${r.status}`).join("\n");
    alert("Notification Triggered:\n" + summary);
}

function renderSettingsAndMigrations() {
    const s = STATE.settings;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };
    setVal("set-store-name", s.store_name);
    setVal("set-gstin", s.gstin);
    setVal("set-phone", s.phone);
    setVal("set-addr1", s.address_line1);
    setVal("set-addr2", s.address_line2);
    setVal("set-prefix", s.bill_prefix || "INV-");
    setVal("set-width", s.thermal_width || "80mm");
    setVal("set-footer", s.footer_note);
    setVal("set-watermark", localStorage.getItem("pos_receipt_watermark") || s.store_name || "");
    if (typeof loadBusinessAndSocialSettings === "function") loadBusinessAndSocialSettings();

    const ledgerEl = document.getElementById("ledger-tbody");
    if (ledgerEl) ledgerEl.innerHTML = STATE.stock_ledger
        .map(
            (l) => `
        <tr>
            <td class="mono" style="font-size:0.84rem;color:var(--text-muted);">${fmtDate(l.created_at)}</td>
            <td><strong class="mono">${l.sku}</strong> ${l.garment_name} (${l.size})</td>
            <td class="text-center"><span class="badge ${l.change_qty >= 0 ? "badge-green" : "badge-amber"}">${l.change_qty >= 0 ? "+" + l.change_qty : l.change_qty}</span></td>
            <td class="text-center mono"><strong>${l.balance_after}</strong></td>
            <td style="font-size:0.84rem;">${l.movement_type} (${l.reference_no})</td>
        </tr>
    `
        )
        .join("");
}

async function saveSettingsForm() {
    await window.appAPI.saveSettings({
        store_name: document.getElementById("set-store-name").value,
        gstin: document.getElementById("set-gstin").value,
        phone: document.getElementById("set-phone").value,
        address_line1: document.getElementById("set-addr1").value,
        address_line2: document.getElementById("set-addr2").value,
        bill_prefix: document.getElementById("set-prefix").value,
        thermal_width: document.getElementById("set-width").value,
        tax_mode: document.getElementById("pos-tax-mode").value,
        footer_note: document.getElementById("set-footer").value,
    });
    await refreshAll();
    alert("Settings saved.");
}

async function runBackup() {
    const btn = document.getElementById("btn-settings-backup");
    if (btn) { btn.disabled = true; btn.textContent = "Backing up..."; }
    const res = await window.appAPI.backupDatabase();
    if (btn) {
        btn.disabled = false;
        btn.textContent = res.ok ? "Backup Saved" : "Backup Failed";
        setTimeout(() => { btn.textContent = "Backup Database"; }, 3500);
    }
    if (res && res.ok) {
        alert("PostgreSQL database backup saved to:\n" + res.path);
    } else if (res && res.error) {
        alert("Backup failed: " + res.error);
    }
}

async function exportReport(type) {
    await window.appAPI.exportCsv(type);
}

function openCompanion() {
    window.appAPI.openCompanionWindow("billing");
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("open");
}

// Keyboard Shortcuts (Dedicated per Interface: POS Terminal vs Back-Office ERP)
window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        closePosSettingsDrawer();
        closePosLookup();
        ["modal-pos-receipt", "modal-held-carts", "modal-recent-bills", "modal-erp-receipt", "modal-garment", "modal-customer", "modal-retail-ops"].forEach(closeModal);
        return;
    }
    if (window.APP_INTERFACE === "pos") {
        if (e.key === "F1") {
            e.preventDefault();
            document.getElementById("pos-scan")?.focus();
        } else if (e.key === "F2") {
            e.preventDefault();
            document.getElementById("pos-phone")?.focus();
        } else if (e.key === "F4") {
            e.preventDefault();
            clearCart();
        } else if (e.key === "F8") {
            e.preventDefault();
            openPosReceiptModal();
        } else if (e.key === "F12") {
            e.preventDefault();
            submitBillCheckout();
        }
    } else {
        if (e.key === "F1") {
            e.preventDefault();
            switchView("view-dashboard");
        } else if (e.key === "F2") {
            e.preventDefault();
            switchView("view-inventory");
        } else if (e.key === "F3") {
            e.preventDefault();
            switchView("view-customers");
        }
    }
});

window.addEventListener("DOMContentLoaded", async () => {
    loadSavedTypography();
    initSidebarDragResize();
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode") || "all";

    const syncLabel = document.getElementById("app-sync-text");
    const minLoaderTimer = new Promise((resolve) => setTimeout(resolve, 1200));

    // Check secure session & synchronize Dual-DB workspace behind the 5s Bismillah loader
    const startupSync = (async () => {
        try {
            if (syncLabel) syncLabel.textContent = "Connecting to Dual-DB Cloud...";
            const auth = await window.appAPI.authStatus();
            if (auth && auth.authenticated) {
                if (syncLabel) syncLabel.textContent = "Synchronizing inventory & customers...";
                await refreshAll();
                if (window.APP_INTERFACE === "pos" || mode === "billing") switchView("view-billing");
                else switchView("view-dashboard");
                if (syncLabel) syncLabel.textContent = "Ready";
            } else {
                if (syncLabel) syncLabel.textContent = "Security lock ready";
            }
            return auth;
        } catch (_) {
            if (syncLabel) syncLabel.textContent = "Ready";
            return { authenticated: false };
        }
    })();

    const [, authState] = await Promise.all([minLoaderTimer, startupSync]);

    const loader = document.getElementById("startup-app-loader");
    if (loader) {
        loader.classList.add("fade-out");
        setTimeout(() => { loader.style.display = "none"; }, 600);
    }

    if (!authState || !authState.authenticated) {
        showPinLogin();
    }
});


// ============================================================================
// DEDICATED POS TERMINAL DRAWERS, HELD CARTS & BACK-OFFICE RECEIPT MODAL
// ============================================================================
function isPosInterface() {
    return window.APP_INTERFACE === "pos";
}

function togglePosSettingsView() {
    const settingsPane = document.getElementById("view-settings");
    if (settingsPane && settingsPane.classList.contains("active")) {
        closePosSettingsDrawer();
    } else {
        openPosSettingsDrawer("stab-general");
    }
}

function openPosSettingsDrawer(tabId) {
    const billingPane = document.getElementById("view-billing");
    const settingsPane = document.getElementById("view-settings");
    const titleEl = document.getElementById("topbar-title");
    const btnEl = document.getElementById("btn-pos-settings-toggle");
    if (billingPane) billingPane.classList.remove("active");
    if (settingsPane) settingsPane.classList.add("active");
    if (titleEl) titleEl.textContent = "Settings";
    if (btnEl) {
        btnEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg><span>Back to Billing</span>`;
    }
    switchSettingsTab(tabId || "stab-general");
}

function closePosSettingsDrawer() {
    const billingPane = document.getElementById("view-billing");
    const settingsPane = document.getElementById("view-settings");
    const titleEl = document.getElementById("topbar-title");
    const btnEl = document.getElementById("btn-pos-settings-toggle");
    if (settingsPane) settingsPane.classList.remove("active");
    if (billingPane) billingPane.classList.add("active");
    if (titleEl) titleEl.textContent = "Billing Counter";
    if (btnEl) {
        btnEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg><span>Settings</span>`;
    }
}

function openRecentBillsModal() {
    const modal = document.getElementById("modal-recent-bills");
    if (modal) modal.classList.add("open");
}

function getHeldCarts() {
    try {
        return JSON.parse(localStorage.getItem("pos_held_carts") || "[]");
    } catch (_) {
        return [];
    }
}

function saveHeldCarts(list) {
    localStorage.setItem("pos_held_carts", JSON.stringify(list));
    updateHeldCartsBadge();
}

function updateHeldCartsBadge() {
    const btn = document.getElementById("btn-held-carts");
    if (!btn) return;
    const list = getHeldCarts();
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span>Held (${list.length})</span>`;
}

function holdCurrentCart() {
    if (!STATE.cart || !STATE.cart.length) {
        alert("Cart is empty. Add garments before holding a bill.");
        return;
    }
    const list = getHeldCarts();
    const totalEst = STATE.cart.reduce((s, c) => s + Number(c.selling_price || 0) * Number(c.qty || 1), 0);
    list.unshift({
        held_at: new Date().toISOString(),
        customer_phone: document.getElementById("pos-phone")?.value || "",
        customer_name: document.getElementById("pos-name")?.value || "Walk-in Customer",
        customer_city: document.getElementById("pos-city")?.value || "",
        discount: document.getElementById("pos-discount")?.value || "0",
        cart: JSON.parse(JSON.stringify(STATE.cart)),
        total_est: totalEst,
    });
    saveHeldCarts(list);
    clearCart();
}

function openHeldCartsModal() {
    const list = getHeldCarts();
    const tbody = document.getElementById("held-carts-tbody");
    if (tbody) {
        if (!list.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding:22px;color:var(--text-muted);">No parked/held bills right now. Press F4 during billing to park a cart.</td></tr>`;
        } else {
            tbody.innerHTML = list
                .map(
                    (h, idx) => `
                <tr>
                    <td class="mono" style="font-size:0.84rem;">${fmtDate(h.held_at)}</td>
                    <td><strong>${h.customer_name}</strong> ${h.customer_phone ? `<span class="mono">(${h.customer_phone})</span>` : ""}</td>
                    <td class="text-center mono">${h.cart.reduce((n, i) => n + Number(i.qty || 1), 0)} pcs</td>
                    <td class="text-right mono"><strong>${fmtINR(h.total_est)}</strong></td>
                    <td class="text-right">
                        <div style="display:inline-flex;gap:4px;">
                            <button type="button" class="btn btn-xs btn-primary" onclick="resumeHeldCart(${idx})">Resume Bill</button>
                            <button type="button" class="btn btn-xs btn-danger" onclick="deleteHeldCart(${idx})">&times;</button>
                        </div>
                    </td>
                </tr>`
                )
                .join("");
        }
    }
    const modal = document.getElementById("modal-held-carts");
    if (modal) modal.classList.add("open");
}

function resumeHeldCart(idx) {
    const list = getHeldCarts();
    const item = list[idx];
    if (!item) return;
    list.splice(idx, 1);
    saveHeldCarts(list);
    STATE.cart = item.cart || [];
    STATE.lastBill = null;
    STATE.lastBillItems = null;
    if (document.getElementById("pos-phone")) document.getElementById("pos-phone").value = item.customer_phone || "";
    if (document.getElementById("pos-name")) document.getElementById("pos-name").value = item.customer_name || "";
    if (document.getElementById("pos-city")) document.getElementById("pos-city").value = item.customer_city || "";
    if (document.getElementById("pos-discount")) document.getElementById("pos-discount").value = item.discount || "0";
    recalcCart();
    closeModal("modal-held-carts");
}

function deleteHeldCart(idx) {
    const list = getHeldCarts();
    list.splice(idx, 1);
    saveHeldCarts(list);
    openHeldCartsModal();
}


function getGarmentColourHex(colourName) {
    const c = String(colourName || "").toLowerCase();
    if (c.includes("maroon") || c.includes("wine") || c.includes("burgundy")) return "#881337";
    if (c.includes("gold") || c.includes("mustard") || c.includes("amber")) return "#D97706";
    if (c.includes("ivory") || c.includes("cream") || c.includes("off white")) return "#E2E8F0";
    if (c.includes("black") || c.includes("charcoal")) return "#0F172A";
    if (c.includes("navy") || c.includes("royal") || c.includes("blue")) return "#1D4ED8";
    if (c.includes("emerald") || c.includes("green") || c.includes("olive") || c.includes("pista")) return "#059669";
    if (c.includes("peach") || c.includes("pink") || c.includes("rose")) return "#E11D48";
    if (c.includes("silver") || c.includes("grey")) return "#64748B";
    if (c.includes("brown") || c.includes("coffee") || c.includes("tan")) return "#78350F";
    return "#2563EB";
}

function selectPosCategoryPill(catVal) {
    const sel = document.getElementById("pos-cat-select");
    if (sel) sel.value = catVal;
    document.querySelectorAll("#pos-cat-pills .cat-pill").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-cat") === catVal);
    });
    renderPosGrid();
}

function selectPaymentTile(payMode) {
    const sel = document.getElementById("pos-pay-mode");
    if (sel) sel.value = payMode;
    document.querySelectorAll("#pos-pay-tiles .pay-tile").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-pay") === payMode);
    });
    onPaymentModeChange();
}


// ============================================================================
// D-MART LOOKUP, WATERMARK, WHATSAPP DESKTOP, FLOATING MENU & BI FORECASTING
// ============================================================================
let posLookupOpen = false;
let salesForecastChart = null;

function renderPosLookup() {
    const dd = document.getElementById("pos-lookup-dropdown");
    const tbody = document.getElementById("pos-lookup-tbody");
    const scanEl = document.getElementById("pos-scan");
    const catEl = document.getElementById("pos-cat-select");
    if (!dd || !tbody) return;

    const q = (scanEl ? scanEl.value : "").toLowerCase().trim();
    const cat = catEl ? catEl.value : "ALL";
    if (!q && !posLookupOpen) {
        dd.classList.remove("open");
        return;
    }

    const matches = (STATE.garments || []).filter((g) => {
        if (cat !== "ALL" && g.category !== cat) return false;
        if (!q) return true;
        const hay = `${g.sku} ${g.barcode} ${g.name} ${g.category} ${g.size} ${g.colour} ${g.rack_location || ""}`.toLowerCase();
        return hay.includes(q);
    }).slice(0, 40);

    if (!matches.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding:18px;color:var(--text-muted);">No matching garments found. Add garments in Inventory &amp; CRM.</td></tr>`;
    } else {
        tbody.innerHTML = matches.map((g) => `
            <tr style="cursor:pointer;" onclick="addGarmentToCart(${g.id}); closePosLookup();">
                <td class="mono"><strong>${g.sku}</strong></td>
                <td><strong>${g.name}</strong></td>
                <td>${g.category}</td>
                <td class="text-center"><span class="tile-size-badge mono">${g.size}</span> ${g.colour}</td>
                <td class="text-center"><span class="badge ${g.stock_qty <= 0 ? "badge-red" : g.stock_qty <= g.min_stock_alert ? "badge-amber" : "badge-green"}">${g.stock_qty}</span></td>
                <td class="text-right mono"><strong>${fmtINR(g.selling_price)}</strong></td>
                <td class="text-right"><button type="button" class="btn btn-xs btn-primary">+ Add</button></td>
            </tr>
        `).join("");
    }
    dd.classList.add("open");
}

function togglePosBrowseAll() {
    posLookupOpen = !posLookupOpen;
    if (posLookupOpen) renderPosLookup();
    else closePosLookup();
}

function closePosLookup() {
    posLookupOpen = false;
    const dd = document.getElementById("pos-lookup-dropdown");
    if (dd) dd.classList.remove("open");
}

document.addEventListener("click", (e) => {
    const leftCol = document.querySelector(".dmart-left-col");
    if (leftCol && !leftCol.contains(e.target)) {
        closePosLookup();
    }
    const sb = document.getElementById("app-sidebar");
    const hbtn = document.getElementById("btn-erp-menu");
    if (sb && sb.classList.contains("floating-open") && !sb.contains(e.target) && (!hbtn || !hbtn.contains(e.target))) {
        sb.classList.remove("floating-open");
    }
});

function openPosReceiptModal() {
    renderThermalPreview();
    const modal = document.getElementById("modal-pos-receipt");
    if (modal) modal.classList.add("open");
}

function openWhatsAppQuick() {
    const phone = (STATE.lastBill && STATE.lastBill.customer_phone) || document.getElementById("pos-phone")?.value || "";
    const name = (STATE.lastBill && STATE.lastBill.customer_name) || document.getElementById("pos-name")?.value || "Customer";
    const storeName = (STATE.settings && STATE.settings.store_name) || "Our Showroom";
    const billNo = (STATE.lastBill && STATE.lastBill.bill_no) || STATE.next_bill_no || "INV";
    const totalEl = document.getElementById("lbl-grand");
    const totalStr = STATE.lastBill ? fmtINR(STATE.lastBill.grand_total) : (totalEl ? totalEl.textContent : "₹0.00");

    const text = `Hello ${name}, thank you for shopping at ${storeName}! Bill ${billNo} Total: ${totalStr}. Visit us again!`;
    if (window.appAPI && window.appAPI.openWhatsApp) {
        window.appAPI.openWhatsApp({ phone, text });
    } else {
        let digits = String(phone || "").replace(/\D/g, "");
        if (digits.length === 10) digits = "91" + digits;
        const url = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(url, "_blank");
    }
}

function openCustomerWhatsApp(phone, name) {
    const storeName = (STATE.settings && STATE.settings.store_name) || "Our Showroom";
    const text = `Hello ${name || "Customer"}, greetings from ${storeName}! Let us know if you'd like to explore our latest collection.`;
    if (window.appAPI && window.appAPI.openWhatsApp) {
        window.appAPI.openWhatsApp({ phone, text });
    } else {
        let digits = String(phone || "").replace(/\D/g, "");
        if (digits.length === 10) digits = "91" + digits;
        window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, "_blank");
    }
}

async function endPosSession() {
    if (!confirm("End Counter Session and shut down Billing Counter?")) return;
    if (window.appAPI && window.appAPI.endSession) {
        await window.appAPI.endSession();
    } else if (window.appAPI && window.appAPI.logout) {
        await window.appAPI.logout();
        window.location.reload();
    } else {
        window.close();
    }
}

function toggleFloatingSidebar(e) {
    if (e) e.stopPropagation();
    const sb = document.getElementById("app-sidebar");
    if (sb) sb.classList.toggle("floating-open");
}

function closeFloatingSidebar() {
    const sb = document.getElementById("app-sidebar");
    if (sb) sb.classList.remove("floating-open");
}

function autoFillHsnFromCategory(catId, hsnId) {
    const cat = document.getElementById(catId)?.value || "";
    const hsnEl = document.getElementById(hsnId);
    if (!hsnEl) return;
    const map = {
        "Handwork Sherwani": "6203",
        "Plain Sherwani": "6203",
        "Jodhpuri": "6203",
        "Handwork Suits": "6203",
        "Plain Suits": "6203",
        "Kurta Pyjama": "6205",
        "Pathani": "6211",
        "Tobh": "6211",
        "Sadiri": "6211",
        "Kids Wear": "6203",
        "Pagdi": "6505",
        "Jooti": "6403",
    };
    if (map[cat]) hsnEl.value = map[cat];
}

function computeSalesForecastChart() {
    const canvas = document.getElementById("chart-sales-forecast");
    if (!canvas || typeof Chart === "undefined") return;

    // Aggregate daily revenue from recent bills
    const dailyMap = {};
    (STATE.recent_bills || []).forEach((b) => {
        const dt = new Date(b.created_at);
        if (isNaN(dt.getTime())) return;
        const key = dt.toISOString().slice(0, 10);
        dailyMap[key] = (dailyMap[key] || 0) + Number(b.grand_total || 0);
    });

    const sortedDates = Object.keys(dailyMap).sort();
    const labels = [];
    const actualVals = [];

    if (sortedDates.length === 0) {
        for (let i = 6; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86400000);
            labels.push(d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }));
            actualVals.push(0);
        }
    } else {
        sortedDates.slice(-10).forEach((k) => {
            const d = new Date(k);
            labels.push(d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }));
            actualVals.push(+dailyMap[k].toFixed(2));
        });
    }

    // Simple Linear Regression (y = m*x + b) over actual points to predict next 5 days + 30D projection
    const n = actualVals.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += actualVals[i];
        sumXY += i * actualVals[i];
        sumXX += i * i;
    }
    const denom = n * sumXX - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const intercept = n > 0 ? (sumY - slope * sumX) / n : 0;

    const forecastVals = new Array(Math.max(0, n - 1)).fill(null);
    if (n > 0) forecastVals.push(actualVals[n - 1]);

    let next7Total = 0;
    for (let f = 1; f <= 5; f++) {
        const d = new Date(Date.now() + f * 86400000);
        labels.push(d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + " (Est)");
        actualVals.push(null);
        const pred = Math.max(0, +(intercept + slope * (n - 1 + f)).toFixed(2));
        forecastVals.push(pred);
    }
    for (let d = 1; d <= 30; d++) {
        next7Total += Math.max(0, intercept + slope * (n - 1 + d));
    }

    const avgY = n > 0 ? sumY / n : 0;
    const trendPct = avgY > 0 ? +((slope / avgY) * 100).toFixed(1) : 0;
    const trendBadge = document.getElementById("bi-trend-badge");
    const est30El = document.getElementById("bi-forecast-30d");
    if (trendBadge) {
        if (trendPct > 0.5) {
            trendBadge.className = "badge badge-green";
            trendBadge.textContent = `▲ +${trendPct}% Upward Trend`;
        } else if (trendPct < -0.5) {
            trendBadge.className = "badge badge-red";
            trendBadge.textContent = `▼ ${trendPct}% Downward Trend`;
        } else {
            trendBadge.className = "badge badge-blue";
            trendBadge.textContent = "Steady Trajectory";
        }
    }
    if (est30El) est30El.textContent = `Est. 30D: ${fmtINR(next7Total)}`;

    if (salesForecastChart) salesForecastChart.destroy();
    salesForecastChart = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: "Actual Revenue (₹)",
                    data: actualVals,
                    borderColor: "#0A0A0A",
                    backgroundColor: "rgba(10, 10, 10, 0.06)",
                    borderWidth: 2.2,
                    tension: 0.32,
                    fill: true,
                    pointRadius: 3,
                },
                {
                    label: "Predicted Trend (₹)",
                    data: forecastVals,
                    borderColor: "#737373",
                    borderDash: [5, 5],
                    borderWidth: 2.2,
                    tension: 0.32,
                    pointRadius: 3,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
            scales: {
                y: { beginAtZero: true, grid: { color: "#F1F5F9" } },
                x: { grid: { display: false }, ticks: { font: { size: 10 } } },
            },
        },
    });
}

function saveBusinessCustomizations() {
    localStorage.setItem("biz_vip_threshold", document.getElementById("biz-vip-threshold")?.value || "25000");
    localStorage.setItem("biz_low_stock_default", document.getElementById("biz-low-stock-default")?.value || "3");
    localStorage.setItem("biz_default_hsn", document.getElementById("biz-default-hsn")?.value || "6203");
    alert("Business & Inventory customizations saved.");
}

function loadBusinessAndSocialSettings() {
    const vipEl = document.getElementById("biz-vip-threshold");
    const lowEl = document.getElementById("biz-low-stock-default");
    const hsnEl = document.getElementById("biz-default-hsn");
    if (vipEl) vipEl.value = localStorage.getItem("biz_vip_threshold") || "25000";
    if (lowEl) lowEl.value = localStorage.getItem("biz_low_stock_default") || "3";
    if (hsnEl) hsnEl.value = localStorage.getItem("biz_default_hsn") || "6203";

    ["instagram", "facebook", "google", "youtube"].forEach((k) => {
        const el = document.getElementById("soc-" + k);
        if (el) el.value = localStorage.getItem("soc_" + k) || "";
    });
}

function saveSocialLinks() {
    ["instagram", "facebook", "google", "youtube"].forEach((k) => {
        const el = document.getElementById("soc-" + k);
        if (el) localStorage.setItem("soc_" + k, el.value.trim());
    });
    alert("Social Media channel links saved.");
}

function openSocialLink(inputId) {
    const val = document.getElementById(inputId)?.value?.trim();
    if (!val) return alert("Paste your profile URL first.");
    window.open(val.startsWith("http") ? val : "https://" + val, "_blank");
}

function loadCampaignTemplate(type) {
    const store = (STATE.settings && STATE.settings.store_name) || "Our Showroom";
    const templates = {
        wedding: `Royal Wedding Collection at ${store}! Explore handcrafted Zardozi Sherwanis, Jodhpuris & Designer Kurta Sets. Visit our showroom today for custom fitting!`,
        eid: `Eid Mubarak from ${store}! Discover our latest Festive Silk Kurtas, Pathanis & Handwork Sherwanis. Exclusive seasonal offers live in-store now!`,
        diwali: `Celebrate Diwali in style with ${store}! Flat festive deals on Ethnic Suits, Sadiri Jackets & Designer Menswear. Visit us today!`,
        new: `Just Landed at ${store}! Fresh designer menswear stock in all sizes (36–46) is now on display. Book your trial in-store!`,
    };
    const ta = document.getElementById("soc-campaign-text");
    if (ta) ta.value = templates[type] || "";
}

function copyCampaignPost() {
    const ta = document.getElementById("soc-campaign-text");
    if (!ta || !ta.value.trim()) return alert("Generate or type a campaign message first.");
    navigator.clipboard?.writeText(ta.value);
    alert("Campaign caption copied to clipboard!");
}

function shareCampaignWhatsApp() {
    const msg = document.getElementById("soc-campaign-text")?.value?.trim() || "";
    if (!msg) return alert("Select a template or type a caption first.");
    if (window.appAPI && window.appAPI.openWhatsApp) {
        window.appAPI.openWhatsApp({ phone: "", text: msg });
    } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    }
}

function generateSyncSecret() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let out = "AGM-";
    for (let i = 0; i < 20; i++) out += chars[Math.floor(Math.random() * chars.length)];
    const el = document.getElementById("auto-cloud-secret");
    if (el) el.value = out;
}

// ============================================================================
// LIVE CROSS-APP SYNC (Auto-refresh shared Dual-DB state on tab/window focus)
// ============================================================================
let _lastCloudSyncRefreshAt = 0;
async function triggerCrossAppSyncRefresh() {
    const now = Date.now();
    if (now - _lastCloudSyncRefreshAt < 12000) return;
    if (document.visibilityState === "hidden") return;
    if (document.querySelector(".modal-bg.open")) return;
    if (window.APP_INTERFACE === "pos" && STATE.cart && STATE.cart.length > 0) return;
    const activeTag = (document.activeElement && document.activeElement.tagName || "").toUpperCase();
    if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;
    const overlay = document.getElementById("pin-login-overlay");
    if (overlay && getComputedStyle(overlay).display !== "none") return;

    _lastCloudSyncRefreshAt = now;
    try {
        await refreshAll();
    } catch (_) {}
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") triggerCrossAppSyncRefresh();
});
window.addEventListener("focus", () => {
    triggerCrossAppSyncRefresh();
});

// ============================================================================
// RETAIL OPERATIONS (RETURNS, PURCHASE GRN, CASH SHIFTS, ALTERATIONS, GSTR-1)
// ============================================================================
let _loadedReturnBill = null;

async function openRetailOpsModal(tabId) {
    const modal = document.getElementById("modal-retail-ops");
    if (!modal) return;
    modal.classList.add("open");
    await switchRetailTab(tabId || "rtab-returns");
}

async function switchRetailTab(tabId) {
    document.querySelectorAll(".r-tab").forEach((b) => b.classList.toggle("active", b.getAttribute("data-rtab") === tabId));
    document.querySelectorAll(".r-tab-pane").forEach((p) => {
        p.style.display = p.id === tabId ? "block" : "none";
    });
    if (tabId === "rtab-returns") await loadReturnsHistory();
    else if (tabId === "rtab-purchases") await loadSuppliersAndPurchases();
    else if (tabId === "rtab-shifts") await loadShiftsPanel();
    else if (tabId === "rtab-alterations") await loadAlterationsPanel();
}

async function loadReturnBill() {
    const billNo = (document.getElementById("ret-bill-no")?.value || "").trim();
    const host = document.getElementById("ret-bill-items-host");
    if (!billNo || !host) return;
    const res = await window.appAPI.getBillDetail(billNo);
    if (!res || !res.ok || !res.bill) {
        host.innerHTML = `<span style="color:var(--red);">Bill "${escapeHtml(billNo)}" not found.</span>`;
        _loadedReturnBill = null;
        return;
    }
    _loadedReturnBill = res;
    host.innerHTML = `
        <div style="margin-bottom:6px;">Bill <strong>${escapeHtml(res.bill.bill_no)}</strong> &bull; Customer: <strong>${escapeHtml(res.bill.customer_name)}</strong> &bull; Grand Total: <strong>${fmtINR(res.bill.grand_total)}</strong></div>
        <table class="data-grid">
            <thead><tr><th>SKU</th><th>Garment</th><th class="text-center">Sold Qty</th><th class="text-center">Return Qty</th><th class="text-right">Unit Net</th></tr></thead>
            <tbody>
                ${(res.items || []).map((it, idx) => `
                    <tr>
                        <td class="mono">${escapeHtml(it.sku)}</td>
                        <td>${escapeHtml(it.garment_name)} (${escapeHtml(it.size)}/${escapeHtml(it.colour)})</td>
                        <td class="text-center mono">${it.qty}</td>
                        <td class="text-center"><input type="number" class="input mono ret-item-qty" data-idx="${idx}" value="${it.qty}" min="0" max="${it.qty}" style="width:70px;height:25px;" /></td>
                        <td class="text-right mono">${fmtINR(Number(it.line_total || 0) / Math.max(1, Number(it.qty || 1)))}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

async function submitReturnForm() {
    if (!_loadedReturnBill || !_loadedReturnBill.bill) return alert("Load a valid Bill first.");
    const items = [];
    document.querySelectorAll(".ret-item-qty").forEach((inp) => {
        const idx = Number(inp.getAttribute("data-idx"));
        const qty = Number(inp.value || 0);
        const orig = (_loadedReturnBill.items || [])[idx];
        if (orig && qty > 0) {
            const perUnit = Number(orig.line_total || 0) / Math.max(1, Number(orig.qty || 1));
            items.push({
                garment_id: orig.garment_id,
                sku: orig.sku,
                garment_name: orig.garment_name,
                qty,
                refund_amount: +(perUnit * qty).toFixed(2),
            });
        }
    });
    if (!items.length) return alert("Set Return Qty >= 1 for at least one garment.");
    const res = await window.appAPI.returnBill({
        bill_id: _loadedReturnBill.bill.id,
        bill_no: _loadedReturnBill.bill.bill_no,
        reason: document.getElementById("ret-reason")?.value || "Size Exchange",
        refund_mode: document.getElementById("ret-refund-mode")?.value || "Credit Note",
        items,
    });
    if (!res || !res.ok) return alert("Return failed: " + (res?.error || "Unknown error"));
    alert(`Return ${res.return_no} recorded!${res.credit_note_code ? `\nCredit Note: ${res.credit_note_code}` : ""}`);
    _loadedReturnBill = null;
    document.getElementById("ret-bill-items-host").textContent = "Return recorded and stock restored.";
    await refreshAll();
    await loadReturnsHistory();
}

async function loadReturnsHistory() {
    const tbody = document.getElementById("ret-history-tbody");
    if (!tbody || !window.appAPI.listReturns) return;
    const res = await window.appAPI.listReturns();
    const rows = (res && res.returns) || [];
    tbody.innerHTML = rows.length
        ? rows.map((r) => `
            <tr>
                <td class="mono"><strong>${escapeHtml(r.return_no)}</strong></td>
                <td class="mono">${escapeHtml(r.bill_no)}</td>
                <td>${escapeHtml(r.reason || "—")}</td>
                <td class="mono"><strong>${escapeHtml(r.credit_note_code || "—")}</strong></td>
                <td class="text-right mono">${fmtINR(r.refund_amount)}</td>
                <td><span class="badge badge-blue">${escapeHtml(r.refund_mode || "Credit Note")}</span></td>
            </tr>
        `).join("")
        : `<tr><td colspan="6" class="text-center" style="padding:16px;color:var(--text-muted);">No returns processed yet.</td></tr>`;
}

async function loadSuppliersAndPurchases() {
    const supSel = document.getElementById("pur-supplier");
    const garSel = document.getElementById("pur-garment");
    const tbody = document.getElementById("pur-history-tbody");
    const ov = window.appAPI.retailOverview ? await window.appAPI.retailOverview() : { ok: false };
    const suppliers = (ov && ov.suppliers) || [];
    const purchases = (ov && ov.purchases) || [];
    if (supSel) {
        supSel.innerHTML = suppliers.length
            ? suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.city || "Local")})</option>`).join("")
            : `<option value="">Walk-in / General Supplier</option>`;
    }
    if (garSel) {
        garSel.innerHTML = (STATE.garments || [])
            .map((g) => `<option value="${g.id}">${escapeHtml(g.sku)} - ${escapeHtml(g.name)} (${escapeHtml(g.size)})</option>`)
            .join("");
    }
    if (tbody) {
        tbody.innerHTML = purchases.length
            ? purchases.map((p) => `
                <tr>
                    <td class="mono"><strong>${escapeHtml(p.grn_no)}</strong> / ${escapeHtml(p.supplier_invoice_no || "—")}</td>
                    <td>${escapeHtml(p.supplier_name || "General")}</td>
                    <td class="mono">${fmtDate(p.created_at)}</td>
                    <td class="text-center mono">${p.total_qty}</td>
                    <td class="text-right mono">${fmtINR(p.total_amount)}</td>
                </tr>
            `).join("")
            : `<tr><td colspan="5" class="text-center" style="padding:16px;color:var(--text-muted);">No purchase GRNs recorded yet.</td></tr>`;
    }
}

async function submitSupplierForm() {
    const name = (document.getElementById("sup-name")?.value || "").trim();
    if (!name) return alert("Supplier name is required.");
    const res = await window.appAPI.saveSupplier({
        name,
        phone: document.getElementById("sup-phone")?.value || "",
        gstin: document.getElementById("sup-gstin")?.value || "",
        city: document.getElementById("sup-city")?.value || "",
    });
    if (!res || !res.ok) return alert("Save supplier error: " + (res?.error || "Unknown"));
    document.getElementById("sup-name").value = "";
    await loadSuppliersAndPurchases();
}

async function submitPurchaseForm() {
    const garmentId = Number(document.getElementById("pur-garment")?.value || 0);
    const qty = Number(document.getElementById("pur-qty")?.value || 0);
    const cost = Number(document.getElementById("pur-cost")?.value || 0);
    if (!garmentId || qty <= 0) return alert("Select a garment SKU and quantity > 0.");
    const res = await window.appAPI.recordPurchase({
        supplier_id: document.getElementById("pur-supplier")?.value || null,
        supplier_invoice_no: document.getElementById("pur-inv")?.value || "",
        items: [{ garment_id: garmentId, qty, cost_price: cost }],
    });
    if (!res || !res.ok) return alert("Purchase GRN error: " + (res?.error || "Unknown"));
    alert(`Purchase ${res.grn_no} posted! Stock increased by ${qty}.`);
    await refreshAll();
    await loadSuppliersAndPurchases();
}

async function loadShiftsPanel() {
    const tbody = document.getElementById("shifts-history-tbody");
    const badge = document.getElementById("shift-status-badge");
    const btnOpen = document.getElementById("btn-open-shift");
    const btnClose = document.getElementById("btn-close-shift");
    if (!window.appAPI.listShifts) return;
    const res = await window.appAPI.listShifts();
    const shifts = (res && res.shifts) || [];
    const active = shifts.find((s) => s.status === "OPEN");
    if (badge) {
        badge.className = active ? "badge badge-green" : "badge badge-amber";
        badge.textContent = active ? `OPEN (${active.shift_no})` : "NO OPEN SHIFT";
    }
    if (btnOpen) btnOpen.style.display = active ? "none" : "inline-flex";
    if (btnClose) btnClose.style.display = active ? "inline-flex" : "none";
    if (tbody) {
        tbody.innerHTML = shifts.length
            ? shifts.map((s) => `
                <tr>
                    <td class="mono"><strong>${escapeHtml(s.shift_no)}</strong></td>
                    <td>${escapeHtml(s.cashier_name || "Counter")}</td>
                    <td class="mono">${fmtINR(s.opening_cash)}</td>
                    <td class="mono">${fmtINR(s.expected_cash)}</td>
                    <td class="mono">${s.closing_cash != null ? fmtINR(s.closing_cash) : "—"}</td>
                    <td class="mono">${s.variance != null ? fmtINR(s.variance) : "—"}</td>
                    <td><span class="badge ${s.status === "OPEN" ? "badge-green" : "badge-blue"}">${escapeHtml(s.status)}</span></td>
                </tr>
            `).join("")
            : `<tr><td colspan="7" class="text-center" style="padding:16px;color:var(--text-muted);">No register shifts recorded yet.</td></tr>`;
    }
}

async function submitOpenShift() {
    const res = await window.appAPI.openShift({
        cashier_name: document.getElementById("shift-cashier")?.value || "Main Counter",
        opening_cash: Number(document.getElementById("shift-cash-input")?.value || 0),
    });
    if (!res || !res.ok) return alert(res?.error || "Could not open shift.");
    await loadShiftsPanel();
}

async function submitCloseShift() {
    const closing = Number(document.getElementById("shift-cash-input")?.value || 0);
    const res = await window.appAPI.closeShift({ closing_cash: closing });
    if (!res || !res.ok) return alert(res?.error || "Could not close shift.");
    const z = res.shift || {};
    alert(`Z-Report Complete (${z.shift_no || "Shift"})\nExpected Cash: ${fmtINR(z.expected_cash)}\nActual Cash: ${fmtINR(z.closing_cash)}\nVariance: ${fmtINR(z.variance)}`);
    await loadShiftsPanel();
}

async function loadAlterationsPanel() {
    const tbody = document.getElementById("alt-history-tbody");
    if (!tbody || !window.appAPI.listAlterations) return;
    const res = await window.appAPI.listAlterations();
    const rows = (res && res.alterations) || [];
    tbody.innerHTML = rows.length
        ? rows.map((a) => `
            <tr>
                <td class="mono"><strong>${escapeHtml(a.slip_no)}</strong></td>
                <td>${escapeHtml(a.customer_name)} ${a.customer_phone ? `(${escapeHtml(a.customer_phone)})` : ""}</td>
                <td>${escapeHtml(a.garment_ref || "—")}</td>
                <td>${escapeHtml(a.notes)}</td>
                <td class="mono">${escapeHtml(a.due_date || "—")}</td>
                <td><span class="badge ${a.status === "DELIVERED" ? "badge-green" : "badge-amber"}">${escapeHtml(a.status)}</span></td>
                <td class="text-right">
                    ${a.status !== "DELIVERED" ? `<button type="button" class="btn btn-xs" onclick="updateAlterationStatus(${a.id}, '${a.status === "PENDING" ? "READY" : "DELIVERED"}')">Mark ${a.status === "PENDING" ? "Ready" : "Delivered"}</button>` : "Done"}
                </td>
            </tr>
        `).join("")
        : `<tr><td colspan="7" class="text-center" style="padding:16px;color:var(--text-muted);">No alteration slips yet.</td></tr>`;
}

async function submitAlterationForm() {
    const customer_name = (document.getElementById("alt-cust")?.value || "").trim();
    const notes = (document.getElementById("alt-notes")?.value || "").trim();
    if (!customer_name || !notes) return alert("Customer name and fitting notes are required.");
    const res = await window.appAPI.saveAlteration({
        customer_name,
        customer_phone: document.getElementById("alt-phone")?.value || "",
        garment_ref: document.getElementById("alt-garment")?.value || "",
        due_date: document.getElementById("alt-due")?.value || "",
        notes,
        status: "PENDING",
    });
    if (!res || !res.ok) return alert(res?.error || "Could not save slip.");
    document.getElementById("alt-notes").value = "";
    await loadAlterationsPanel();
}

async function updateAlterationStatus(id, status) {
    await window.appAPI.saveAlteration({ id, status });
    await loadAlterationsPanel();
}

async function downloadGstr1Json() {
    if (window.appAPI.exportGstr1) await window.appAPI.exportGstr1();
}

