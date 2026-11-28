pub mod commands;
pub mod db;
pub mod gst;
pub mod printer;
pub mod sync;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub struct AppState {
    pub db_path: PathBuf,
    pub backup_dir: PathBuf,
    pub export_dir: PathBuf,
    pub auth_role: Mutex<Option<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("AGMShowroomSuite"));
            let db_path = data_dir.join("agm_showroom.sqlite");
            let backup_dir = data_dir.join("backups");
            let export_dir = app
                .path()
                .download_dir()
                .unwrap_or_else(|_| data_dir.join("exports"))
                .join("AGM_Showroom_Exports");

            db::init_schema(&db_path).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

            let bg_db = db_path.clone();
            tauri::async_runtime::spawn(async move {
                let mut ticker = tokio::time::interval(Duration::from_secs(30));
                loop {
                    ticker.tick().await;
                    let _ = sync::push_outbox_once(&bg_db).await;
                }
            });

            app.manage(AppState {
                db_path,
                backup_dir,
                export_dir,
                auth_role: Mutex::new(None),
            });

            let args: Vec<String> = std::env::args().collect();
            if args.iter().any(|a| a == "--billing" || a == "--pos") {
                if let Some(main_win) = app.get_webview_window("main") {
                    let _ = main_win.hide();
                }
                let _ = WebviewWindowBuilder::new(
                    app,
                    "billing",
                    WebviewUrl::App("pos.html".into()),
                )
                .title("AGM Billing Counter — Dedicated POS Mode")
                .inner_size(1340.0, 840.0)
                .center()
                .build();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::cmd_auth_status,
            commands::cmd_login,
            commands::cmd_logout,
            commands::cmd_bootstrap,
            commands::cmd_save_garment,
            commands::cmd_generate_matrix,
            commands::cmd_adjust_stock,
            commands::cmd_delete_garment,
            commands::cmd_list_customers,
            commands::cmd_find_customer_by_phone,
            commands::cmd_get_customer_history,
            commands::cmd_save_customer,
            commands::cmd_checkout_bill,
            commands::cmd_get_bill_detail,
            commands::cmd_return_bill,
            commands::cmd_save_settings,
            commands::cmd_save_automations,
            commands::cmd_resend_notification,
            commands::cmd_retail_overview,
            commands::cmd_list_suppliers,
            commands::cmd_save_supplier,
            commands::cmd_record_purchase,
            commands::cmd_list_returns,
            commands::cmd_check_credit_note,
            commands::cmd_list_shifts,
            commands::cmd_open_shift,
            commands::cmd_close_shift,
            commands::cmd_list_alterations,
            commands::cmd_save_alteration,
            commands::cmd_export_gstr1,
            commands::cmd_sync_cloud_now,
            commands::cmd_get_printers,
            commands::cmd_print_thermal,
            commands::cmd_save_receipt_pdf,
            commands::cmd_backup_database,
            commands::cmd_export_csv,
            commands::cmd_open_companion_window,
            commands::cmd_open_external_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AGM Showroom Suite");
}
