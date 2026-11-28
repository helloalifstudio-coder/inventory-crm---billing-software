/**
 * Indian Apparel GST Calculation Engine (Sept 2025 GST Council Slab Reform Compliant)
 *   - Up to Rs. 2,500 per piece (post-discount effective value): 5% GST
 *   - Above Rs. 2,500 per piece (post-discount effective value): 18% GST
 *   - Supports Intra-State (CGST + SGST) and Inter-State (IGST)
 */
function computeLineGST(unitPrice, qty, lineDiscount, taxMode, customOpts = {}) {
    const q = Math.max(1, Number(qty || 1));
    const price = Math.max(0, Number(unitPrice || 0));
    const disc = Math.max(0, Number(lineDiscount || 0));
    const gross = Math.max(0, price * q - disc);
    const effectiveUnit = gross / q;
    const isIgst = Boolean(customOpts.isIgst);

    let gstRate;
    if (customOpts.customGstEnabled) {
        if (customOpts.customGstRate !== undefined && customOpts.customGstRate !== null && customOpts.customGstRate !== "") {
            gstRate = Math.max(0, Number(customOpts.customGstRate));
        } else {
            const c = Math.max(0, Number(customOpts.customCgstRate ?? 2.5));
            const s = Math.max(0, Number(customOpts.customSgstRate ?? 2.5));
            gstRate = Number((c + s).toFixed(2));
        }
    } else {
        // Post-discount per-piece threshold: <= 2500 ex-tax (<= 2625 incl at 5%) -> 5%, else 18%
        if (taxMode === "inclusive") {
            gstRate = effectiveUnit <= 2625.0 ? 5.0 : 18.0;
        } else {
            gstRate = effectiveUnit <= 2500.0 ? 5.0 : 18.0;
        }
    }

    let taxableValue, totalTax;
    if (taxMode === "inclusive") {
        taxableValue = Number((gross / (1 + gstRate / 100)).toFixed(2));
        totalTax = Number((gross - taxableValue).toFixed(2));
    } else {
        taxableValue = Number(gross.toFixed(2));
        totalTax = Number((taxableValue * (gstRate / 100)).toFixed(2));
    }

    let cgstRate = 0,
        sgstRate = 0,
        igstRate = 0,
        cgstAmount = 0,
        sgstAmount = 0,
        igstAmount = 0;

    if (isIgst) {
        igstRate = Number(gstRate.toFixed(2));
        igstAmount = totalTax;
    } else if (customOpts.customGstEnabled && customOpts.customCgstRate !== undefined && customOpts.customSgstRate !== undefined) {
        cgstRate = Math.max(0, Number(customOpts.customCgstRate));
        sgstRate = Math.max(0, Number(customOpts.customSgstRate));
        cgstAmount = Number((totalTax * (gstRate > 0 ? cgstRate / gstRate : 0.5)).toFixed(2));
        sgstAmount = Number((totalTax - cgstAmount).toFixed(2));
    } else {
        cgstRate = Number((gstRate / 2).toFixed(2));
        sgstRate = Number((gstRate - cgstRate).toFixed(2));
        cgstAmount = Number((totalTax / 2).toFixed(2));
        sgstAmount = Number((totalTax - cgstAmount).toFixed(2));
    }

    const lineTotal = taxMode === "inclusive"
        ? Number(gross.toFixed(2))
        : Number((taxableValue + totalTax).toFixed(2));

    return {
        taxable_value: taxableValue,
        gst_rate: gstRate,
        cgst_rate: cgstRate,
        cgst_amount: cgstAmount,
        sgst_rate: sgstRate,
        sgst_amount: sgstAmount,
        igst_rate: igstRate,
        igst_amount: igstAmount,
        line_total: lineTotal,
    };
}

module.exports = { computeLineGST };
