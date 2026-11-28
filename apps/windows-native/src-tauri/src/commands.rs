use crate::{db, printer, sync, AppState};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

fn err_json(msg: String) -> Value {
    json!({ "ok": false, "error": msg })
}

#[tauri::command]
pub fn cmd_auth_status(state: State<AppState>) -> Value {
    let guard = state.auth_role.lock().unwrap();
    json!({
        "ok": true,
        "authenticated": guard.is_some(),
        "role": *guard
    })
}

#[tauri::command]
pub fn cmd_login(state: State<AppState>, pin: String) -> Value {
    match db::verify_pin(&state.db_path, &pin) {
        Ok(Some(role)) => {
            *state.auth_role.lock().unwrap() = Some(role.clone());
            json!({ "ok": true, "role": role })
        }
        Ok(None) => json!({ "ok": false, "error": "Invalid Showroom PIN." }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn cmd_logout(state: State<AppState>) -> Value {
    *state.auth_role.lock().unwrap() = None;
    json!({ "ok": true })
}

#[tauri::command]
pub fn cmd_bootstrap(state: State<AppState>) -> Value {
    db::get_bootstrap(&state.db_path).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_save_garment(state: State<AppState>, payload: Value) -> Value {
    db::save_garment(&state.db_path, &payload).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_generate_matrix(state: State<AppState>, payload: Value) -> Value {
    db::generate_matrix(&state.db_path, &payload).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_adjust_stock(state: State<AppState>, payload: Value) -> Value {
    db::adjust_stock(&state.db_path, &payload).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_delete_garment(state: State<AppState>, id: i64) -> Value {
    db::delete_garment(&state.db_path, id).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_list_customers(state: State<AppState>, payload: Value) -> Value {
    db::list_customers(&state.db_path, &payload).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_find_customer_by_phone(state: State<AppState>, phone: String) -> Value {
    db::find_customer_by_phone(&state.db_path, &phone).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_get_customer_history(state: State<AppState>, customer_id: i64) -> Value {
    db::get_customer_history(&state.db_path, customer_id).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_save_customer(state: State<AppState>, payload: Value) -> Value {
    db::save_customer(&state.db_path, &payload).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_checkout_bill(state: State<AppState>, payload: Value) -> Value {
    db::checkout_bill(&state.db_path, &payload).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_get_bill_detail(state: State<AppState>, key: String) -> Value {
    db::get_bill_detail(&state.db_path, &key).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_return_bill(state: State<AppState>, payload: Value) -> Value {
    db::return_bill(&state.db_path, &payload).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_save_settings(state: State<AppState>, payload: Value) -> Value {
    db::save_settings(&state.db_path, &payload).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_save_automations(state: State<AppState>, payload: Value) -> Value {
    db::save_automations(&state.db_path, &payload).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_resend_notification(_state: State<AppState>, bill_no: String) -> Value {
    json!({
        "ok": true,
        "waLinkUrl": format!("https://wa.me/?text=Receipt%20for%20{}", bill_no),
        "results": []
    })
}

#[tauri::command]
pub fn cmd_retail_overview(state: State<AppState>) -> Value {
    db::retail_overview(&state.db_path).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_list_suppliers(state: State<AppState>) -> Value {
    db::retail_overview(&state.db_path).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_save_supplier(state: State<AppState>, payload: Value) -> Value {
    db::save_supplier(&state.db_path, &payload).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_record_purchase(state: State<AppState>, payload: Value) -> Value {
    db::record_purchase(&state.db_path, &payload).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_list_returns(state: State<AppState>) -> Value {
    db::list_returns(&state.db_path).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_check_credit_note(state: State<AppState>, code: String) -> Value {
    db::check_credit_note(&state.db_path, &code).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_list_shifts(state: State<AppState>) -> Value {
    db::list_shifts(&state.db_path).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_open_shift(state: State<AppState>, payload: Value) -> Value {
    db::open_shift(&state.db_path, &payload).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_close_shift(state: State<AppState>, payload: Value) -> Value {
    db::close_shift(&state.db_path, &payload).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_list_alterations(state: State<AppState>) -> Value {
    db::list_alterations(&state.db_path).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_save_alteration(state: State<AppState>, payload: Value) -> Value {
    db::save_alteration(&state.db_path, &payload).unwrap_or_else(err_json)
}

#[tauri::command]
pub fn cmd_export_gstr1(state: State<AppState>) -> Value {
    match db::export_gstr1_file(&state.db_path, &state.export_dir) {
        Ok(path) => json!({ "ok": true, "path": path }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub async fn cmd_sync_cloud_now(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(sync::push_outbox_once(&state.db_path).await.unwrap_or_else(err_json))
}

#[tauri::command]
pub fn cmd_get_printers() -> Value {
    let printers = printer::enumerate_windows_printers();
    json!({ "ok": true, "native": true, "printers": printers })
}

#[tauri::command]
pub fn cmd_print_thermal(state: State<AppState>, opts: Value) -> Value {
    let printer_name = opts
        .get("printerName")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            printer::enumerate_windows_printers()
                .into_iter()
                .find(|p| {
                    p.is_default
                        && !p.name.contains("PDF")
                        && !p.name.contains("XPS")
                        && !p.name.contains("OneNote")
                })
                .map(|p| p.name)
        });

    let Some(target_printer) = printer_name else {
        return json!({ "ok": true, "fallbackBrowserPrint": true });
    };

    let bill_key = opts
        .get("billNo")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let boot = match db::get_bootstrap(&state.db_path) {
        Ok(b) => b,
        Err(e) => return err_json(e),
    };
    let settings = &boot["settings"];
    let roll = settings["thermal_width"].as_str().unwrap_or("80mm");
    let detail = if bill_key.is_empty() {
        boot["recent_bills"]
            .get(0)
            .and_then(|b| b["bill_no"].as_str())
            .and_then(|bno| db::get_bill_detail(&state.db_path, bno).ok())
    } else {
        db::get_bill_detail(&state.db_path, bill_key).ok()
    };

    let Some(det) = detail else {
        return json!({ "ok": true, "fallbackBrowserPrint": true });
    };
    let bill = &det["bill"];
    let items = det["items"].as_array().cloned().unwrap_or_default();
    let drawer = bill["payment_mode"].as_str() == Some("Cash");
    let bytes = printer::build_escpos_receipt(settings, bill, &items, roll, drawer);
    match printer::write_raw_to_printer(&target_printer, &bytes) {
        Ok(written) => json!({ "ok": true, "printer": target_printer, "bytes": written }),
        Err(_) => json!({ "ok": true, "fallbackBrowserPrint": true }),
    }
}

#[tauri::command]
pub fn cmd_save_receipt_pdf(_bill_no: Option<String>) -> Value {
    json!({ "ok": true, "fallbackBrowserPrint": true, "pdfPath": "Windows Print to PDF Dialog" })
}

#[tauri::command]
pub fn cmd_backup_database(state: State<AppState>) -> Value {
    match db::backup_database_atomic(&state.db_path, &state.backup_dir) {
        Ok(path) => json!({ "ok": true, "path": path }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn cmd_export_csv(state: State<AppState>, report_type: String) -> Value {
    match db::export_csv_file(&state.db_path, &report_type, &state.export_dir) {
        Ok(path) => json!({ "ok": true, "path": path }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn cmd_open_companion_window(app: AppHandle, _mode: String) -> Value {
    if let Some(win) = app.get_webview_window("billing") {
        let _ = win.set_focus();
        return json!({ "ok": true });
    }
    match WebviewWindowBuilder::new(&app, "billing", WebviewUrl::App("pos.html".into()))
        .title("AGM Billing Counter — High-Speed POS")
        .inner_size(1340.0, 840.0)
        .min_inner_size(980.0, 680.0)
        .center()
        .build()
    {
        Ok(_) => json!({ "ok": true }),
        Err(e) => err_json(e.to_string()),
    }
}

#[tauri::command]
pub fn cmd_open_external_url(app: AppHandle, url: String) -> Value {
    match app.opener().open_url(url, None::<&str>) {
        Ok(_) => json!({ "ok": true }),
        Err(e) => err_json(e.to_string()),
    }
}
