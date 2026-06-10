// First-run sample data so every screen works immediately.
import { tx, reqp } from './idb';

// ISO date (YYYY-MM-DD) helper offset from today.
function dayOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const UNIT = 'Forbes Family Cafe';
const COMPASS = 'COMPASS-44873';
const LOC_DRY = 'Dry Storage';
const LOC_COOLER = 'Walk-in Cooler';

// product fields + optional `prefill` and optional `audit` record.
const SAMPLES = [
  {
    storage_location: LOC_DRY,
    item_description: 'Cheez-It Baked Snack Crackers, Original',
    brand: 'Cheez-It', distributor: 'US Foods', distributor_sku: 'USF-880421',
    gtin: '0024100110056', manufacturer: 'Kellanova',
    audit_status: 'pending',
    prefill: {
      ingredients_text: 'Enriched flour (wheat flour, niacin, reduced iron, thiamin mononitrate, riboflavin, folic acid), vegetable oil (soybean, palm, and/or canola oil), cheese made with skim milk (skim milk, whey protein, salt, cheese cultures, annatto extract for color, enzymes), salt, paprika, yeast, paprika extract for color.',
      allergens_tags: ['en:gluten', 'en:milk', 'en:wheat'],
      traces_tags: ['en:soybeans'],
    },
  },
  {
    storage_location: LOC_DRY,
    item_description: 'Skippy Creamy Peanut Butter, #10 can',
    brand: 'Skippy', distributor: 'US Foods', distributor_sku: 'USF-119033',
    gtin: '0037600105019', manufacturer: 'Hormel Foods',
    audit_status: 'pending',
    prefill: {
      ingredients_text: 'Roasted peanuts, sugar, hydrogenated vegetable oil (cottonseed, soybean and rapeseed oil) to prevent separation, salt.',
      allergens_tags: ['en:peanuts'],
      traces_tags: ['en:tree-nuts', 'en:soybeans'],
    },
  },
  {
    storage_location: LOC_COOLER,
    item_description: 'Silk Unsweetened Almond Milk, half gallon',
    brand: 'Silk', distributor: 'Sysco', distributor_sku: 'SYS-447781',
    gtin: '0025293001619', manufacturer: 'Danone North America',
    audit_status: 'pending',
    prefill: {
      ingredients_text: 'Almondmilk (filtered water, almonds), calcium carbonate, sea salt, potassium citrate, sunflower lecithin, gellan gum, natural flavor, vitamin A palmitate, vitamin D2, D-alpha-tocopherol (vitamin E).',
      allergens_tags: ['en:nuts'],
      traces_tags: [],
    },
  },
  {
    storage_location: LOC_DRY,
    item_description: 'All-Purpose Bulk Flour, 50 lb',
    brand: 'King Arthur', distributor: 'Sysco', distributor_sku: 'SYS-200114',
    gtin: '', manufacturer: 'King Arthur Baking',
    audit_status: 'pending',
  },
  {
    storage_location: LOC_DRY,
    item_description: 'Local Wildflower Honey, 5 lb jug',
    brand: 'Best Bees Co.', distributor: 'Local Direct', distributor_sku: 'LOC-HNY-05',
    gtin: '', manufacturer: 'Best Bees Company',
    audit_status: 'in_progress',
    audit: {
      vendor_type: 'Local Artisan',
      ingredients: 'Raw wildflower honey.',
      ask_us_flag: 1,
      notes: 'Awaiting allergen statement from beekeeper.',
      // in_progress: started but not signed off, so no date_reviewed / review_due
      reviewed_by: 'Dana Whitfield',
    },
  },
  {
    storage_location: LOC_DRY,
    item_description: 'House-Made Maple Pecan Granola',
    brand: 'Forbes Kitchen', distributor: 'House-Made', distributor_sku: 'HM-GRAN-01',
    gtin: '', manufacturer: 'Forbes Family Cafe Kitchen',
    audit_status: 'complete',
    audit: {
      vendor_type: 'House-Made',
      ingredients: 'Rolled oats, pecans, maple syrup, brown sugar, canola oil, salt, cinnamon.',
      allergen_tree_nuts: 1, allergen_gluten: 1,
      ask_us_flag: 1,
      reviewed_by: 'Dana Whitfield',
      date_reviewed: dayOffset(-10), review_due: dayOffset(80),
      notes: 'Oats are not certified gluten-free; flag gluten cross-contact.',
    },
  },
  {
    storage_location: LOC_COOLER,
    item_description: 'House-Made Roasted Red Pepper Hummus',
    brand: 'Forbes Kitchen', distributor: 'House-Made', distributor_sku: 'HM-HUMM-02',
    gtin: '', manufacturer: 'Forbes Family Cafe Kitchen',
    audit_status: 'complete',
    audit: {
      vendor_type: 'House-Made',
      ingredients: 'Chickpeas, tahini (sesame), roasted red peppers, lemon juice, garlic, olive oil, cumin, salt.',
      allergen_sesame: 1,
      ask_us_flag: 1,
      reviewed_by: 'Marcus Lee',
      date_reviewed: dayOffset(-5), review_due: dayOffset(85),
      notes: 'Tahini = sesame. Prepared in shared kitchen.',
    },
  },
  {
    storage_location: LOC_DRY,
    item_description: 'Heinz Tomato Ketchup, #10 can',
    brand: 'Heinz', distributor: 'US Foods', distributor_sku: 'USF-330217',
    gtin: '0013000006057', manufacturer: 'Kraft Heinz',
    audit_status: 'complete',
    audit: {
      vendor_type: 'FDA Packaged',
      ingredients: 'Tomato concentrate from red ripe tomatoes, distilled vinegar, high fructose corn syrup, corn syrup, salt, spice, onion powder, natural flavoring.',
      reviewed_by: 'Marcus Lee',
      date_reviewed: dayOffset(-3), review_due: dayOffset(87),
      notes: 'No Big-9 allergens declared on label.',
    },
  },
  {
    storage_location: LOC_COOLER,
    item_description: 'Tillamook Medium Cheddar, 2 lb loaf',
    brand: 'Tillamook', distributor: 'Sysco', distributor_sku: 'SYS-551902',
    gtin: '0072830000123', manufacturer: 'Tillamook County Creamery',
    audit_status: 'complete',
    audit: {
      vendor_type: 'FDA Packaged',
      ingredients: 'Pasteurized milk, salt, cheese cultures, enzymes, annatto (color).',
      allergen_milk: 1,
      reviewed_by: 'Dana Whitfield',
      // OVERDUE: review_due in the past
      date_reviewed: dayOffset(-120), review_due: dayOffset(-30),
      notes: 'Due for re-review.',
    },
  },
  {
    storage_location: LOC_DRY,
    item_description: 'Barilla Penne Pasta, 20 lb case',
    brand: 'Barilla', distributor: 'US Foods', distributor_sku: 'USF-771140',
    gtin: '0076808514971', manufacturer: 'Barilla America',
    audit_status: 'pending',
  },
];

const ALLERGEN_KEYS = [
  'milk', 'eggs', 'fish', 'shellfish', 'tree_nuts',
  'peanuts', 'wheat', 'soybeans', 'sesame', 'gluten',
];

export async function seedIfEmpty() {
  return tx(['units', 'products', 'audits'], 'readwrite', async (t) => {
    const products = t.objectStore('products');
    const count = await reqp(products.count());
    if (count > 0) return false;

    await reqp(t.objectStore('units').put({ unit_name: UNIT, compass_id: COMPASS }));

    for (const s of SAMPLES) {
      const id = await reqp(products.add({
        unit_name: UNIT,
        compass_id: COMPASS,
        storage_location: s.storage_location,
        item_description: s.item_description,
        brand: s.brand,
        distributor: s.distributor,
        distributor_sku: s.distributor_sku,
        gtin: s.gtin || null,
        manufacturer: s.manufacturer,
        audit_scope: 1,
        audit_status: s.audit_status || 'pending',
        gtin_prefill: s.prefill ? { ...s.prefill, source: 'openfoodfacts' } : null,
      }));

      if (s.audit) {
        const a = s.audit;
        await reqp(t.objectStore('audits').add({
          product_id: id,
          vendor_type: a.vendor_type || null,
          ingredients: a.ingredients || null,
          voluntary_disclaimers: a.voluntary_disclaimers || null,
          ...Object.fromEntries(ALLERGEN_KEYS.map((k) => [`allergen_${k}`, a[`allergen_${k}`] || 0])),
          allergen_other: a.allergen_other || null,
          ask_us_flag: a.ask_us_flag || 0,
          reviewed_by: a.reviewed_by || null,
          date_reviewed: a.date_reviewed || null,
          review_due: a.review_due || null,
          gtin_prefill_used: a.gtin_prefill_used || 0,
          notes: a.notes || null,
        }));
      }
    }
    return true;
  });
}
