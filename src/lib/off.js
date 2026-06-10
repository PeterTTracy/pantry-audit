// Open Food Facts GTIN lookup, straight from the browser (the API sends CORS
// headers). Advisory pre-fill only — never written to audit records until
// staff confirm. Failures are non-fatal: prefill is optional convenience data.
const OFF_URL = (gtin) =>
  `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(gtin)}.json`;

async function lookup(gtin) {
  const res = await fetch(OFF_URL(gtin), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  return data.product;
}

export async function fetchPrefill(gtin) {
  if (!gtin) return null;
  try {
    let p = await lookup(gtin);
    // Inventory exports carry 14-digit case codes; OFF indexes most products
    // by 13-digit EAN. A leading-zero GTIN-14 is the same code as its last 13
    // digits, so retry with that on a miss.
    if (!p && gtin.length === 14 && gtin.startsWith('0')) {
      p = await lookup(gtin.slice(1));
    }
    if (!p) return null;

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
