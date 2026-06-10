// Canonical allergen column keys, in display order.
const ALLERGEN_KEYS = [
  'milk', 'eggs', 'fish', 'shellfish', 'tree_nuts',
  'peanuts', 'wheat', 'soybeans', 'sesame', 'gluten',
];

// Maps Open Food Facts allergen/trace tag fragments -> our canonical keys.
// OFF tags look like "en:milk", "en:tree-nuts", "en:crustaceans".
const OFF_TAG_MAP = {
  milk: 'milk',
  eggs: 'eggs',
  egg: 'eggs',
  fish: 'fish',
  crustaceans: 'shellfish',
  molluscs: 'shellfish',
  shellfish: 'shellfish',
  'tree-nuts': 'tree_nuts',
  nuts: 'tree_nuts',
  peanuts: 'peanuts',
  wheat: 'wheat',
  soybeans: 'soybeans',
  soya: 'soybeans',
  soy: 'soybeans',
  sesame: 'sesame',
  'sesame-seeds': 'sesame',
  gluten: 'gluten',
};

// Given an array of OFF tags, return { milk: true, gluten: true, ... }.
function tagsToAllergenFlags(tags) {
  const flags = {};
  if (!Array.isArray(tags)) return flags;
  for (const raw of tags) {
    const frag = String(raw).split(':').pop().trim().toLowerCase();
    const key = OFF_TAG_MAP[frag];
    if (key) flags[key] = true;
  }
  return flags;
}

module.exports = { ALLERGEN_KEYS, OFF_TAG_MAP, tagsToAllergenFlags };
