// Open Food Facts GTIN lookup, straight from the browser (the API sends CORS
// headers). Advisory pre-fill only — never written to audit records until
// staff confirm. Failures are non-fatal: prefill is optional convenience data.
const OFF_URL = (gtin) =>
  `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(gtin)}.json`;

// GS1: a 14-digit case code wraps the consumer item's code. The contained
// GTIN-13 (what's printed on the retail unit, and what OFF indexes) is
// digits 2-13 with the check digit recomputed.
export function innerGtin13(gtin14) {
  const body = gtin14.slice(1, 13);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  return body + ((10 - (sum % 10)) % 10);
}

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
    let matchedCode = gtin;
    let p = await lookup(gtin);
    // Inventory exports carry 14-digit case codes; OFF indexes the consumer
    // unit. On a miss, retry with the derived consumer GTIN-13.
    if (!p && gtin.length === 14) {
      const inner = innerGtin13(gtin);
      if (inner !== gtin) {
        p = await lookup(inner);
        if (p) matchedCode = inner;
      }
    }
    if (!p) return null;

    return {
      ingredients_text: p.ingredients_text || p.ingredients_text_en || '',
      allergens_tags: Array.isArray(p.allergens_tags) ? p.allergens_tags : [],
      traces_tags: Array.isArray(p.traces_tags) ? p.traces_tags : [],
      product_name: p.product_name || p.product_name_en || '',
      brands: p.brands || '',
      // Photo of the ingredients panel when OFF has one; falls back to the
      // front-of-pack shot. Lets staff verify against the physical label.
      label_image: p.image_ingredients_url || p.image_url || '',
      source: 'openfoodfacts',
      fetched_for_gtin: gtin,
      matched_code: matchedCode,
    };
  } catch {
    return null;
  }
}
