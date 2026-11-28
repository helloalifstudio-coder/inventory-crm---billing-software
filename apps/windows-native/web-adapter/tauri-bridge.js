(function () {
    const tauri = window.__TAURI__;
    if (!tauri || !tauri.core || typeof tauri.core.invoke !== "function") {
        return;
    }

    const invoke = tauri.core.invoke;
    window.IS_NATIVE_WINDOWS = true;

    const call = (cmd, payload) => invoke(cmd, { payload: payload || {} });

    window.appAPI = {
        authStatus: () => invoke("cmd_auth_status"),
        login: (pin) => invoke("cmd_login", { pin: String(pin || "") }),
        logout: () => invoke("cmd_logout"),
        bootstrap: () => invoke("cmd_bootstrap"),

        saveGarment: (payload) => call("cmd_save_garment", payload),
        generateMatrix: (payload) => call("cmd_generate_matrix", payload),
        adjustStock: (payload) => call("cmd_adjust_stock", payload),
        deleteGarment: (id) => invoke("cmd_delete_garment", { id: Number(id) }),

        listCustomers: (params) => call("cmd_list_customers", params),
        findCustomerByPhone: (phone) => invoke("cmd_find_customer_by_phone", { phone: String(phone || "") }),
        getCustomerHistory: (customerId) => invoke("cmd_get_customer_history", { customerId: Number(customerId) }),
        saveCustomer: (payload) => call("cmd_save_customer", payload),

        checkoutBill: (payload) => call("cmd_checkout_bill", payload),
        getBillDetail: (billIdOrNo) => invoke("cmd_get_bill_detail", { key: String(billIdOrNo || "") }),
        returnBill: (payload) => call("cmd_return_bill", payload),

        saveSettings: (payload) => call("cmd_save_settings", payload),
        saveAutomationSettings: (payload) => call("cmd_save_automations", payload),
        resendBillNotifications: (billNo) => invoke("cmd_resend_notification", { billNo: String(billNo || "") }),
        syncSecondary: () => invoke("cmd_sync_cloud_now"),
        archiveExcess: () => invoke("cmd_sync_cloud_now"),

        retailOverview: () => invoke("cmd_retail_overview"),
        listSuppliers: () => invoke("cmd_list_suppliers"),
        saveSupplier: (payload) => call("cmd_save_supplier", payload),
        recordPurchase: (payload) => call("cmd_record_purchase", payload),
        listReturns: () => invoke("cmd_list_returns"),
        checkCreditNote: (code) => invoke("cmd_check_credit_note", { code: String(code || "") }),
        listShifts: () => invoke("cmd_list_shifts"),
        openShift: (payload) => call("cmd_open_shift", payload),
        closeShift: (payload) => call("cmd_close_shift", payload),
        listAlterations: () => invoke("cmd_list_alterations"),
        saveAlteration: (payload) => call("cmd_save_alteration", payload),
        syncCloudNow: () => invoke("cmd_sync_cloud_now"),
        printThermal: async (opts) => {
            const payloadOpts = Object.assign(
                { billNo: (window.STATE && window.STATE.lastBill && window.STATE.lastBill.bill_no) || "" },
                opts || {}
            );
            const res = await invoke("cmd_print_thermal", { opts: payloadOpts });
            if (res && res.fallbackBrowserPrint) {
                window.print();
            }
            return res;
        },
        saveReceiptPdf: async (billNo) => {
            await invoke("cmd_save_receipt_pdf", { billNo: String(billNo || "") });
            window.print();
            return { ok: true, pdfPath: "Windows Print to PDF Dialog" };
        },
        exportGstr1: async () => {
            const res = await invoke("cmd_export_gstr1");
            if (res && res.ok && res.path) alert("GSTR-1 JSON saved to:\n" + res.path);
            return res;
        },
        backupDatabase: async () => {
            const res = await invoke("cmd_backup_database");
            return res;
        },
        exportCsv: async (reportType) => {
            const res = await invoke("cmd_export_csv", { reportType: String(reportType || "bills") });
            if (res && res.ok && res.path) alert("CSV saved to:\n" + res.path);
            return res;
        },
        openCompanionWindow: (mode) => invoke("cmd_open_companion_window", { mode: String(mode || "billing") }),
        openWhatsApp: ({ phone, text } = {}) => {
            let digits = String(phone || "").replace(/\D/g, "");
            if (digits.length === 10) digits = "91" + digits;
            const url = digits
                ? `https://wa.me/${digits}?text=${encodeURIComponent(String(text || ""))}`
                : `https://wa.me/?text=${encodeURIComponent(String(text || ""))}`;
            return invoke("cmd_open_external_url", { url });
        },
        endSession: async () => {
            await invoke("cmd_logout");
            if (typeof showPinLogin === "function") showPinLogin();
            return { ok: true };
        },
    };
})();
