// Open Food Facts GTIN lookup, straight from the browser (the API sends CORS
// headers). Advisory pre-fill only — never written to audit records until
// staff confirm. Failures are non-fatal: prefill is optional convenience data.
const OFF_URL = (gtin) =>
  `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(gtin)}.json`;

export async function fetchPrefill(gtin) {
  if (!gtin) return null;
  try {
    const res = await fetch(OFF_URL(gtin), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;

    const p = data.product;
    return {
      ingredients_text: p.ingredients_text || p.ingredients_text_en || '',
      allergens_tags: Array.isArray(p.allergens_tags) ? p.allergens_tags : [],
      traces_tags: Array.isArray(p.traces_tags) ? p.traces_tags : [],
      source: 'openfoodfacts',
      fetched_for_gtin: gtin,
    };
  } catch {
    return null;
  }
}
