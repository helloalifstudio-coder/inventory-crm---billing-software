use crate::db;
use rusqlite::params;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

pub async fn push_outbox_once(db_path: &Path) -> Result<Value, String> {
    let (cloud_url, cloud_secret, batch): (String, String, Vec<(i64, Value)>) = {
        let conn = db::open_conn(db_path)?;
        let (url, secret): (String, String) = conn
            .query_row(
                "SELECT COALESCE(cloud_sync_url,''), COALESCE(cloud_sync_secret,'') FROM automation_settings WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap_or_default();

        if url.trim().is_empty() {
            return Ok(json!({ "ok": true, "skipped": true, "reason": "Offline / no Cloud Sync URL set" }));
        }

        let mut stmt = conn
            .prepare("SELECT id, record_uuid, table_name, op_type, payload_json FROM sync_outbox WHERE synced = 0 ORDER BY id ASC LIMIT 50")
            .map_err(|e| e.to_string())?;
        let rows: Vec<(i64, Value)> = stmt
            .query_map([], |r| {
                let payload_str: String = r.get(4)?;
                let parsed: Value = serde_json::from_str(&payload_str).unwrap_or(json!({}));
                Ok((
                    r.get::<_, i64>(0)?,
                    json!({
                        "record_uuid": r.get::<_, String>(1)?,
                        "table": r.get::<_, String>(2)?,
                        "op": r.get::<_, String>(3)?,
                        "payload": parsed
                    }),
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|x| x.ok())
            .collect();
        (url, secret, rows)
    };

    if batch.is_empty() {
        return Ok(json!({ "ok": true, "synced": 0 }));
    }

    let endpoint = format!("{}/api/sync", cloud_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;

    let outbox_payload: Vec<Value> = batch.iter().map(|(_, v)| v.clone()).collect();
    let resp = client
        .post(&endpoint)
        .header("x-sync-secret", cloud_secret)
        .json(&json!({
            "device_id": "windows-native",
            "device_name": "AGM Windows Desktop",
            "outbox": outbox_payload
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Cloud sync HTTP {}", resp.status()));
    }

    let conn = db::open_conn(db_path)?;
    for (id, _) in &batch {
        let _ = conn.execute(
            "UPDATE sync_outbox SET synced = 1, synced_at = datetime('now') WHERE id = ?1",
            params![id],
        );
    }

    Ok(json!({ "ok": true, "synced": batch.len() }))
}
