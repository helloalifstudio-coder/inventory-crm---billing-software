use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrinterInfo {
    pub name: String,
    pub port: String,
    pub driver: String,
    pub is_default: bool,
    pub status: u32,
}

#[cfg(windows)]
mod winspool {
    use std::ffi::c_void;

    #[repr(C)]
    pub struct PrinterInfo4W {
        pub p_printer_name: *mut u16,
        pub p_server_name: *mut u16,
        pub attributes: u32,
    }

    #[repr(C)]
    pub struct DocInfo1W {
        pub p_doc_name: *mut u16,
        pub p_output_file: *mut u16,
        pub p_datatype: *mut u16,
    }

    #[link(name = "winspool")]
    extern "system" {
        pub fn EnumPrintersW(
            flags: u32,
            name: *const u16,
            level: u32,
            p_printer_enum: *mut u8,
            cb_buf: u32,
            pcb_needed: *mut u32,
            pc_returned: *mut u32,
        ) -> i32;
        pub fn GetDefaultPrinterW(psz_buffer: *mut u16, pcch_buffer: *mut u32) -> i32;
        pub fn OpenPrinterW(
            p_printer_name: *const u16,
            ph_printer: *mut *mut c_void,
            p_default: *const c_void,
        ) -> i32;
        pub fn StartDocPrinterW(
            h_printer: *mut c_void,
            level: u32,
            p_doc_info: *const DocInfo1W,
        ) -> u32;
        pub fn StartPagePrinter(h_printer: *mut c_void) -> i32;
        pub fn WritePrinter(
            h_printer: *mut c_void,
            p_buf: *const u8,
            cb_buf: u32,
            pc_written: *mut u32,
        ) -> i32;
        pub fn EndPagePrinter(h_printer: *mut c_void) -> i32;
        pub fn EndDocPrinter(h_printer: *mut c_void) -> i32;
        pub fn ClosePrinter(h_printer: *mut c_void) -> i32;
    }
}

#[cfg(windows)]
pub fn enumerate_windows_printers() -> Vec<PrinterInfo> {
    use std::ptr;
    const PRINTER_ENUM_LOCAL: u32 = 0x0000_0002;
    const PRINTER_ENUM_CONNECTIONS: u32 = 0x0000_0004;

    unsafe fn wide_ptr_to_string(ptr_w: *const u16) -> String {
        if ptr_w.is_null() {
            return String::new();
        }
        let mut len = 0usize;
        while *ptr_w.add(len) != 0 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(ptr_w, len))
    }

    unsafe fn default_printer_name() -> String {
        let mut len: u32 = 0;
        winspool::GetDefaultPrinterW(ptr::null_mut(), &mut len);
        if len == 0 {
            return String::new();
        }
        let mut buf = vec![0u16; len as usize];
        if winspool::GetDefaultPrinterW(buf.as_mut_ptr(), &mut len) != 0 {
            let trimmed = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            String::from_utf16_lossy(&buf[..trimmed])
        } else {
            String::new()
        }
    }

    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let mut needed: u32 = 0;
    let mut returned: u32 = 0;

    unsafe {
        let def_name = default_printer_name();
        winspool::EnumPrintersW(flags, ptr::null(), 4, ptr::null_mut(), 0, &mut needed, &mut returned);
        if needed == 0 {
            return Vec::new();
        }
        let mut buf = vec![0u8; needed as usize];
        let ok = winspool::EnumPrintersW(
            flags,
            ptr::null(),
            4,
            buf.as_mut_ptr(),
            needed,
            &mut needed,
            &mut returned,
        );
        if ok == 0 {
            return Vec::new();
        }
        let infos = std::slice::from_raw_parts(
            buf.as_ptr() as *const winspool::PrinterInfo4W,
            returned as usize,
        );
        infos
            .iter()
            .map(|p| {
                let name = wide_ptr_to_string(p.p_printer_name.cast_const());
                let server = wide_ptr_to_string(p.p_server_name.cast_const());
                PrinterInfo {
                    is_default: !def_name.is_empty() && name.eq_ignore_ascii_case(&def_name),
                    name,
                    port: server,
                    driver: "WinSpool RAW".to_string(),
                    status: p.attributes,
                }
            })
            .collect()
    }
}

#[cfg(not(windows))]
pub fn enumerate_windows_printers() -> Vec<PrinterInfo> {
    Vec::new()
}

fn push_line(buf: &mut Vec<u8>, s: &str) {
    buf.extend_from_slice(s.as_bytes());
    buf.push(b'\n');
}

fn push_kv(buf: &mut Vec<u8>, cols: usize, label: &str, val: f64) {
    let right = format!("Rs {:.2}", val);
    let space = cols.saturating_sub(label.len() + right.len()).max(1);
    push_line(buf, &format!("{}{}{}", label, " ".repeat(space), right));
}

pub fn build_escpos_receipt(
    settings: &Value,
    bill: &Value,
    items: &[Value],
    roll_width: &str,
    open_cash_drawer: bool,
) -> Vec<u8> {
    let cols: usize = if roll_width.contains("58") { 32 } else { 48 };
    let mut out: Vec<u8> = Vec::with_capacity(1024);

    // Initialize ESC @
    out.extend_from_slice(&[0x1B, 0x40]);

    let sep = "-".repeat(cols);
    let dsep = "=".repeat(cols);

    // Center align header + Bold ON
    out.extend_from_slice(&[0x1B, 0x61, 0x01, 0x1B, 0x45, 0x01]);
    push_line(
        &mut out,
        settings
            .get("store_name")
            .and_then(|v| v.as_str())
            .unwrap_or("AGM SHOWROOM"),
    );
    out.extend_from_slice(&[0x1B, 0x45, 0x00]);

    for k in ["address_line1", "address_line2"] {
        if let Some(val) = settings.get(k).and_then(|v| v.as_str()) {
            if !val.trim().is_empty() {
                push_line(&mut out, val.trim());
            }
        }
    }
    if let Some(gstin) = settings.get("gstin").and_then(|v| v.as_str()) {
        if !gstin.trim().is_empty() {
            push_line(&mut out, &format!("GSTIN: {}", gstin.trim()));
        }
    }
    push_line(&mut out, &dsep);
    push_line(&mut out, "TAX INVOICE");
    push_line(&mut out, &sep);

    // Left align body
    out.extend_from_slice(&[0x1B, 0x61, 0x00]);
    let bill_no = bill.get("bill_no").and_then(|v| v.as_str()).unwrap_or("INV");
    let cust = bill
        .get("customer_name")
        .and_then(|v| v.as_str())
        .unwrap_or("Walk-in");
    let mode = bill
        .get("payment_mode")
        .and_then(|v| v.as_str())
        .unwrap_or("Cash");

    push_line(&mut out, &format!("Bill: {}   Mode: {}", bill_no, mode));
    push_line(&mut out, &format!("Customer: {}", cust));
    push_line(&mut out, &sep);

    for it in items {
        let name = it.get("garment_name").and_then(|v| v.as_str()).unwrap_or("Item");
        let sku = it.get("sku").and_then(|v| v.as_str()).unwrap_or("");
        let qty = it.get("qty").and_then(|v| v.as_i64()).unwrap_or(1);
        let rate = it.get("unit_price").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let total = it.get("line_total").and_then(|v| v.as_f64()).unwrap_or(0.0);
        push_line(&mut out, name);
        let left = format!("{} | {} x {:.2}", sku, qty, rate);
        let right = format!("{:.2}", total);
        let space = cols.saturating_sub(left.len() + right.len()).max(1);
        push_line(&mut out, &format!("{}{}{}", left, " ".repeat(space), right));
    }

    push_line(&mut out, &sep);
    push_kv(
        &mut out,
        cols,
        "Taxable Value:",
        bill.get("taxable_amount").and_then(|v| v.as_f64()).unwrap_or(0.0),
    );
    let igst = bill.get("igst_amount").and_then(|v| v.as_f64()).unwrap_or(0.0);
    if igst > 0.0 {
        push_kv(&mut out, cols, "IGST:", igst);
    } else {
        push_kv(
            &mut out,
            cols,
            "CGST:",
            bill.get("cgst_amount").and_then(|v| v.as_f64()).unwrap_or(0.0),
        );
        push_kv(
            &mut out,
            cols,
            "SGST:",
            bill.get("sgst_amount").and_then(|v| v.as_f64()).unwrap_or(0.0),
        );
    }

    push_line(&mut out, &dsep);
    out.extend_from_slice(&[0x1B, 0x45, 0x01]);
    push_kv(
        &mut out,
        cols,
        "GRAND TOTAL:",
        bill.get("grand_total").and_then(|v| v.as_f64()).unwrap_or(0.0),
    );
    out.extend_from_slice(&[0x1B, 0x45, 0x00]);
    push_line(&mut out, &dsep);

    out.extend_from_slice(&[0x1B, 0x61, 0x01]);
    if let Some(foot) = settings.get("footer_note").and_then(|v| v.as_str()) {
        if !foot.trim().is_empty() {
            push_line(&mut out, foot.trim());
        }
    }
    push_line(&mut out, "\n\n");

    // Partial paper cut: GS V 66 0
    out.extend_from_slice(&[0x1D, 0x56, 0x42, 0x00]);

    // Optional RJ11 Cash Drawer Kick on Pin 2: ESC p 0 25 250
    if open_cash_drawer {
        out.extend_from_slice(&[0x1B, 0x70, 0x00, 0x19, 0xFA]);
    }
    out
}

#[cfg(windows)]
pub fn write_raw_to_printer(printer_name: &str, bytes: &[u8]) -> Result<usize, String> {
    use std::ffi::c_void;
    use std::ptr;

    let name_w: Vec<u16> = printer_name.encode_utf16().chain(Some(0)).collect();
    let doc_w: Vec<u16> = "AGM Receipt\0".encode_utf16().collect();
    let raw_w: Vec<u16> = "RAW\0".encode_utf16().collect();

    unsafe {
        let mut h_printer: *mut c_void = ptr::null_mut();
        if winspool::OpenPrinterW(name_w.as_ptr(), &mut h_printer, ptr::null()) == 0 {
            return Err(format!("Could not open Windows printer '{}'", printer_name));
        }

        let doc_info = winspool::DocInfo1W {
            p_doc_name: doc_w.as_ptr().cast_mut(),
            p_output_file: ptr::null_mut(),
            p_datatype: raw_w.as_ptr().cast_mut(),
        };

        let job_id = winspool::StartDocPrinterW(h_printer, 1, &doc_info);
        if job_id == 0 {
            winspool::ClosePrinter(h_printer);
            return Err("StartDocPrinterW failed for RAW ESC/POS job".into());
        }

        if winspool::StartPagePrinter(h_printer) == 0 {
            winspool::EndDocPrinter(h_printer);
            winspool::ClosePrinter(h_printer);
            return Err("StartPagePrinter failed".into());
        }

        let mut written: u32 = 0;
        let ok = winspool::WritePrinter(h_printer, bytes.as_ptr(), bytes.len() as u32, &mut written);

        winspool::EndPagePrinter(h_printer);
        winspool::EndDocPrinter(h_printer);
        winspool::ClosePrinter(h_printer);

        if ok == 0 {
            return Err("WritePrinter failed while sending ESC/POS bytes".into());
        }
        Ok(written as usize)
    }
}

#[cfg(not(windows))]
pub fn write_raw_to_printer(_printer_name: &str, bytes: &[u8]) -> Result<usize, String> {
    Ok(bytes.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn builds_valid_80mm_escpos_with_drawer_kick() {
        let settings = json!({
            "store_name": "AGM SHOWROOM",
            "gstin": "27AABCU9603R1ZM",
            "footer_note": "Thank you!"
        });
        let bill = json!({
            "bill_no": "INV-00042",
            "customer_name": "Aarav Shah",
            "payment_mode": "Cash",
            "taxable_amount": 2000.0,
            "cgst_amount": 50.0,
            "sgst_amount": 50.0,
            "grand_total": 2100.0
        });
        let items = vec![json!({
            "garment_name": "Kurta Set",
            "sku": "KP-01",
            "qty": 1,
            "unit_price": 2000.0,
            "line_total": 2100.0
        })];
        let payload = build_escpos_receipt(&settings, &bill, &items, "80mm", true);
        assert!(payload.starts_with(&[0x1B, 0x40]));
        assert!(payload.ends_with(&[0x1B, 0x70, 0x00, 0x19, 0xFA]));
    }
}
