// Pure export-row building, shared by the app and the node:test suite.
// Produces one { sheet, rows } entry per unit, audit-scope products only.

const yn = (v) => (v ? 'Yes' : 'No');

// Excel sheet names: max 31 chars, no : \ / ? * [ ]
export function sheetName(name, used) {
  let base = String(name || 'Unit').replace(/[:\\/?*[\]]/g, ' ').slice(0, 28).trim() || 'Unit';
  let candidate = base, n = 2;
  while (used.has(candidate)) { candidate = `${base.slice(0, 26)} ${n++}`; }
  used.add(candidate);
  return candidate;
}

export function buildExportSheets(products, audits, photoNameByProduct = new Map()) {
  const auditByProduct = new Map(audits.map((a) => [a.product_id, a]));
  const units = [...new Set(products.map((p) => p.unit_name))].sort((a, b) => a.localeCompare(b));
  const used = new Set();

  return units.map((unitName) => {
    const rows = products
      .filter((p) => p.unit_name === unitName && p.audit_scope === 1)
      .sort((x, y) =>
        String(x.storage_location).localeCompare(String(y.storage_location)) ||
        String(x.item_description).localeCompare(String(y.item_description)))
      .map((p) => {
        const a = auditByProduct.get(p.id) || {};
        return {
          'Unit': p.unit_name,
          'Storage Location': p.storage_location,
          'Item Description': p.item_description,
          'Brand': p.brand,
          'GTIN': p.gtin,
          'Distributor SKU': p.distributor_sku,
          'Manufacturer': p.manufacturer,
          'Vendor Type': a.vendor_type || '',
          'Ingredients': a.ingredients || '',
          'Voluntary Disclaimers': a.voluntary_disclaimers || '',
          'Milk': yn(a.allergen_milk),
          'Eggs': yn(a.allergen_eggs),
          'Fish': yn(a.allergen_fish),
          'Shellfish': yn(a.allergen_shellfish),
          'Tree Nuts': yn(a.allergen_tree_nuts),
          'Peanuts': yn(a.allergen_peanuts),
          'Wheat': yn(a.allergen_wheat),
          'Soybeans': yn(a.allergen_soybeans),
          'Sesame': yn(a.allergen_sesame),
          'Gluten': yn(a.allergen_gluten),
          'Other Allergens': a.allergen_other || '',
          'Ask Us Flag': yn(a.ask_us_flag),
          'Label Photo Filename': photoNameByProduct.get(p.id) || '',
          'Reviewed By': a.reviewed_by || '',
          'Date Reviewed': a.date_reviewed || '',
          'Review Due': a.review_due || '',
          'GTIN Prefill Used': yn(a.gtin_prefill_used),
          'Notes': a.notes || '',
        };
      });
    return { sheet: sheetName(unitName, used), rows };
  });
}
