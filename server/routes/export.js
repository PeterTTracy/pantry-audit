const express = require('express');
const XLSX = require('xlsx');
const db = require('../db');

const router = express.Router();

const yn = (v) => (v ? 'Yes' : 'No');

// Excel sheet names: max 31 chars, no : \ / ? * [ ]
function sheetName(name, used) {
  let base = String(name || 'Unit').replace(/[:\\/?*[\]]/g, ' ').slice(0, 28).trim() || 'Unit';
  let candidate = base, n = 2;
  while (used.has(candidate)) { candidate = `${base.slice(0, 26)} ${n++}`; }
  used.add(candidate);
  return candidate;
}

router.get('/export', (req, res) => {
  const units = db.prepare('SELECT DISTINCT unit_name FROM products ORDER BY unit_name').all();

  const rowsStmt = db.prepare(`
    SELECT
      p.unit_name, p.storage_location, p.item_description, p.brand, p.gtin,
      p.distributor_sku, p.manufacturer,
      a.vendor_type, a.ingredients, a.voluntary_disclaimers,
      a.allergen_milk, a.allergen_eggs, a.allergen_fish, a.allergen_shellfish,
      a.allergen_tree_nuts, a.allergen_peanuts, a.allergen_wheat, a.allergen_soybeans,
      a.allergen_sesame, a.allergen_gluten, a.allergen_other, a.ask_us_flag,
      a.label_photo_path, a.reviewed_by, a.date_reviewed, a.review_due,
      a.gtin_prefill_used, a.notes
    FROM products p
    LEFT JOIN audit_records a ON a.product_id = p.id
    WHERE p.unit_name = ? AND p.audit_scope = 1
    ORDER BY p.storage_location, p.item_description
  `);

  const wb = XLSX.utils.book_new();
  const usedNames = new Set();

  for (const u of units) {
    const rows = rowsStmt.all(u.unit_name).map((r) => ({
      'Unit': r.unit_name,
      'Storage Location': r.storage_location,
      'Item Description': r.item_description,
      'Brand': r.brand,
      'GTIN': r.gtin,
      'Distributor SKU': r.distributor_sku,
      'Manufacturer': r.manufacturer,
      'Vendor Type': r.vendor_type || '',
      'Ingredients': r.ingredients || '',
      'Voluntary Disclaimers': r.voluntary_disclaimers || '',
      'Milk': yn(r.allergen_milk),
      'Eggs': yn(r.allergen_eggs),
      'Fish': yn(r.allergen_fish),
      'Shellfish': yn(r.allergen_shellfish),
      'Tree Nuts': yn(r.allergen_tree_nuts),
      'Peanuts': yn(r.allergen_peanuts),
      'Wheat': yn(r.allergen_wheat),
      'Soybeans': yn(r.allergen_soybeans),
      'Sesame': yn(r.allergen_sesame),
      'Gluten': yn(r.allergen_gluten),
      'Other Allergens': r.allergen_other || '',
      'Ask Us Flag': yn(r.ask_us_flag),
      'Label Photo Filename': r.label_photo_path ? r.label_photo_path.split('/').pop() : '',
      'Reviewed By': r.reviewed_by || '',
      'Date Reviewed': r.date_reviewed || '',
      'Review Due': r.review_due || '',
      'GTIN Prefill Used': yn(r.gtin_prefill_used),
      'Notes': r.notes || '',
    }));

    const ws = rows.length
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([['No audit-scope items for this unit.']]);
    XLSX.utils.book_append_sheet(wb, ws, sheetName(u.unit_name, usedNames));
  }

  if (units.length === 0) {
    XLSX.utils.book_append_sheet(
      wb, XLSX.utils.aoa_to_sheet([['No data']]), 'Empty');
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="pantry_audit_export_${stamp}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

module.exports = router;
