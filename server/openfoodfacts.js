const db = require('./db');

const OFF_URL = (gtin) =>
  `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(gtin)}.json`;

// Fetch and store background prefill data for a single product.
// Stores { ingredients_text, allergens_tags, traces_tags } in products.gtin_prefill.
// Never touches audit_records — this is advisory data only.
async function fetchPrefillForProduct(product) {
  if (!product.gtin) return null;
  try {
    const res = await fetch(OFF_URL(product.gtin), {
      headers: { 'User-Agent': 'MIT-Dining-PantryAudit/1.0 (allergen compliance tool)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;

    const p = data.product;
    const prefill = {
      ingredients_text: p.ingredients_text || p.ingredients_text_en || '',
      allergens_tags: Array.isArray(p.allergens_tags) ? p.allergens_tags : [],
      traces_tags: Array.isArray(p.traces_tags) ? p.traces_tags : [],
      source: 'openfoodfacts',
      fetched_for_gtin: product.gtin,
    };
    db.prepare('UPDATE products SET gtin_prefill = ? WHERE id = ?')
      .run(JSON.stringify(prefill), product.id);
    return prefill;
  } catch (err) {
    // Network failures are non-fatal: prefill is optional convenience data.
    console.warn(`[OFF] prefill failed for GTIN ${product.gtin}:`, err.message);
    return null;
  }
}

// Run prefill for every pending product with a GTIN that has no prefill yet.
// Fired in the background after an import; failures are swallowed per-product.
async function runPrefillForUnit(unitName) {
  const rows = db.prepare(`
    SELECT id, gtin FROM products
    WHERE unit_name = ? AND audit_status = 'pending'
      AND gtin IS NOT NULL AND gtin != '' AND gtin_prefill IS NULL
  `).all(unitName);

  for (const row of rows) {
    await fetchPrefillForProduct(row);
  }
  return rows.length;
}

module.exports = { fetchPrefillForProduct, runPrefillForUnit };
