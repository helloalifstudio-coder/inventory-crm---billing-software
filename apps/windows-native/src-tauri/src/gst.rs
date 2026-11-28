use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GstLineResult {
    pub unit_price: f64,
    pub qty: i64,
    pub line_discount: f64,
    pub taxable_value: f64,
    pub gst_rate: f64,
    pub cgst_rate: f64,
    pub cgst_amount: f64,
    pub sgst_rate: f64,
    pub sgst_amount: f64,
    pub igst_rate: f64,
    pub igst_amount: f64,
    pub line_total: f64,
}

pub fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

pub fn calculate_garment_gst(
    unit_price: f64,
    qty: i64,
    line_discount: f64,
    tax_mode: &str,
    custom_cgst: Option<f64>,
    custom_sgst: Option<f64>,
    is_igst: bool,
) -> GstLineResult {
    let q = qty.max(1);
    let unit = unit_price.max(0.0);
    let disc = line_discount.max(0.0);
    let gross = (unit * (q as f64) - disc).max(0.0);
    let eff_unit = gross / (q as f64);

    let (gst_rate, cgst_rate, sgst_rate, igst_rate) = match (custom_cgst, custom_sgst) {
        (Some(cc), Some(cs)) => {
            let total_r = round2(cc.max(0.0) + cs.max(0.0));
            if is_igst {
                (total_r, 0.0, 0.0, total_r)
            } else {
                (total_r, cc.max(0.0), cs.max(0.0), 0.0)
            }
        }
        _ => {
            // Indian Apparel GST (Sept 2025 / 2026 threshold):
            // <= Rs 2,500 pre-tax (<= Rs 2,625 MRP inclusive) => 5%, above => 18%
            let total_r = if tax_mode.eq_ignore_ascii_case("inclusive") {
                if eff_unit <= 2625.0 { 5.0 } else { 18.0 }
            } else if eff_unit <= 2500.0 {
                5.0
            } else {
                18.0
            };
            if is_igst {
                (total_r, 0.0, 0.0, total_r)
            } else {
                (total_r, total_r / 2.0, total_r / 2.0, 0.0)
            }
        }
    };

    let (taxable_value, cgst_amount, sgst_amount, igst_amount, line_total) =
        if tax_mode.eq_ignore_ascii_case("inclusive") {
            let tax_val = round2(gross / (1.0 + gst_rate / 100.0));
            let total_tax = round2(gross - tax_val);
            if is_igst {
                (tax_val, 0.0, 0.0, total_tax, round2(gross))
            } else {
                let c = round2(tax_val * (cgst_rate / 100.0));
                let s = round2(total_tax - c);
                (tax_val, c, s, 0.0, round2(gross))
            }
        } else {
            let tax_val = round2(gross);
            if is_igst {
                let ig = round2(tax_val * (igst_rate / 100.0));
                (tax_val, 0.0, 0.0, ig, round2(tax_val + ig))
            } else {
                let c = round2(tax_val * (cgst_rate / 100.0));
                let s = round2(tax_val * (sgst_rate / 100.0));
                (tax_val, c, s, 0.0, round2(tax_val + c + s))
            }
        };

    GstLineResult {
        unit_price: round2(unit),
        qty: q,
        line_discount: round2(disc),
        taxable_value,
        gst_rate,
        cgst_rate,
        cgst_amount,
        sgst_rate,
        sgst_amount,
        igst_rate,
        igst_amount,
        line_total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apparel_slab_boundary_5_and_18_exclusive() {
        let low = calculate_garment_gst(2500.0, 1, 0.0, "exclusive", None, None, false);
        assert_eq!(low.gst_rate, 5.0);
        assert_eq!(low.cgst_amount, 62.5);
        assert_eq!(low.sgst_amount, 62.5);
        assert_eq!(low.line_total, 2625.0);

        let high = calculate_garment_gst(2501.0, 1, 0.0, "exclusive", None, None, false);
        assert_eq!(high.gst_rate, 18.0);
        assert_eq!(high.cgst_amount, 225.09);
        assert_eq!(high.sgst_amount, 225.09);
        assert_eq!(high.line_total, 2951.18);
    }

    #[test]
    fn post_discount_drops_slab_to_5_percent() {
        // Rs 2700 discounted by Rs 300 => effective Rs 2400 -> qualifies for 5% slab!
        let res = calculate_garment_gst(2700.0, 1, 300.0, "exclusive", None, None, false);
        assert_eq!(res.gst_rate, 5.0);
        assert_eq!(res.taxable_value, 2400.0);
        assert_eq!(res.line_total, 2520.0);
    }

    #[test]
    fn interstate_igst_splits_cleanly() {
        let res = calculate_garment_gst(4000.0, 1, 0.0, "exclusive", None, None, true);
        assert_eq!(res.gst_rate, 18.0);
        assert_eq!(res.cgst_amount, 0.0);
        assert_eq!(res.sgst_amount, 0.0);
        assert_eq!(res.igst_amount, 720.0);
        assert_eq!(res.line_total, 4720.0);
    }
}
