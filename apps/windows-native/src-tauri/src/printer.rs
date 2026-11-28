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
pub fn enumerate_windows_printers() -> Vec<PrinterInfo> {
    use std::ptr;
    use windows_sys::Win32::Graphics::Printing::{
        EnumPrintersW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_2W,
    };
    const PRINTER_ATTRIBUTE_DEFAULT_FLAG: u32 = 0x0000_0004;

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

    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let mut needed: u32 = 0;
    let mut returned: u32 = 0;

    unsafe {
        EnumPrintersW(
            flags,
            ptr::null(),
            2,
            ptr::null_mut(),
            0,
            &mut needed,
            &mut returned,
        );
        if needed == 0 {
            return Vec::new();
        }
        let mut buf = vec![0u8; needed as usize];
        let ok = EnumPrintersW(
            flags,
            ptr::null(),
            2,
            buf.as_mut_ptr(),
            needed,
            &mut needed,
            &mut returned,
        );
        if ok == 0 {
            return Vec::new();
        }
        let infos = std::slice::from_raw_parts(
            buf.as_ptr() as *const PRINTER_INFO_2W,
            returned as usize,
        );
        infos
            .iter()
            .map(|p| PrinterInfo {
                name: wide_ptr_to_string(p.pPrinterName.cast_const()),
                port: wide_ptr_to_string(p.pPortName.cast_const()),
                driver: wide_ptr_to_string(p.pDriverName.cast_const()),
                is_default: (p.Attributes & PRINTER_ATTRIBUTE_DEFAULT_FLAG) != 0,
                status: p.Status,
            })
            .collect()
    }
}

#[cfg(not(windows))]
pub fn enumerate_windows_printers() -> Vec<PrinterInfo> {
    Vec::new()
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

    let push_line = |buf: &mut Vec<u8>, s: &str| {
        buf.extend_from_slice(s.as_bytes());
        buf.push(b'\n');
    };
    let sep = "-".repeat(cols);
    let dsep = "=".repeat(cols);

    // Center align header
    out.extend_from_slice(&[0x1B, 0x61, 0x01]);
    // Bold ON
    out.extend_from_slice(&[0x1B, 0x45, 0x01]);
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
    let mut row_kv = |label: &str, val: f64| {
        let right = format!("Rs {:.2}", val);
        let space = cols.saturating_sub(label.len() + right.len()).max(1);
        push_line(&mut out, &format!("{}{}{}", label, " ".repeat(space), right));
    };

    row_kv(
        "Taxable Value:",
        bill.get("taxable_amount").and_then(|v| v.as_f64()).unwrap_or(0.0),
    );
    let igst = bill.get("igst_amount").and_then(|v| v.as_f64()).unwrap_or(0.0);
    if igst > 0.0 {
        row_kv("IGST:", igst);
    } else {
        row_kv("CGST:", bill.get("cgst_amount").and_then(|v| v.as_f64()).unwrap_or(0.0));
        row_kv("SGST:", bill.get("sgst_amount").and_then(|v| v.as_f64()).unwrap_or(0.0));
    }

    push_line(&mut out, &dsep);
    out.extend_from_slice(&[0x1B, 0x45, 0x01]);
    row_kv(
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
    use std::ptr;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Graphics::Printing::{
        ClosePrinter, DOC_INFO_1W, EndDocPrinter, EndPagePrinter, OpenPrinterW, StartDocPrinterW,
        StartPagePrinter, WritePrinter,
    };

    let name_w: Vec<u16> = printer_name.encode_utf16().chain(Some(0)).collect();
    let doc_w: Vec<u16> = "AGM Receipt\0".encode_utf16().collect();
    let raw_w: Vec<u16> = "RAW\0".encode_utf16().collect();

    unsafe {
        let mut h_printer: HANDLE = ptr::null_mut();
        if OpenPrinterW(name_w.as_ptr(), &mut h_printer, ptr::null()) == 0 {
            return Err(format!("Could not open Windows printer '{}'", printer_name));
        }

        let doc_info = DOC_INFO_1W {
            pDocName: doc_w.as_ptr().cast_mut(),
            pOutputFile: ptr::null_mut(),
            pDatatype: raw_w.as_ptr().cast_mut(),
        };

        let job_id = StartDocPrinterW(
            h_printer,
            1,
            (&doc_info as *const DOC_INFO_1W).cast(),
        );
        if job_id == 0 {
            ClosePrinter(h_printer);
            return Err("StartDocPrinterW failed for RAW ESC/POS job".into());
        }

        if StartPagePrinter(h_printer) == 0 {
            EndDocPrinter(h_printer);
            ClosePrinter(h_printer);
            return Err("StartPagePrinter failed".into());
        }

        let mut written: u32 = 0;
        let ok = WritePrinter(
            h_printer,
            bytes.as_ptr().cast(),
            bytes.len() as u32,
            &mut written,
        );

        EndPagePrinter(h_printer);
        EndDocPrinter(h_printer);
        ClosePrinter(h_printer);

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
