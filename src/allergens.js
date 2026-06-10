// Allergen display config, shared by the form, item list filter, and dashboards.
export const ALLERGENS = [
  { key: 'milk', label: 'Milk' },
  { key: 'eggs', label: 'Eggs' },
  { key: 'fish', label: 'Fish' },
  { key: 'shellfish', label: 'Shellfish' },
  { key: 'tree_nuts', label: 'Tree Nuts' },
  { key: 'peanuts', label: 'Peanuts' },
  { key: 'wheat', label: 'Wheat' },
  { key: 'soybeans', label: 'Soybeans' },
  { key: 'sesame', label: 'Sesame' },
  { key: 'gluten', label: 'Gluten' },
];

export const VENDOR_TYPES = [
  'FDA Packaged',
  'Off-Catalog Retail',
  'House-Made',
  'Local Artisan',
  'Imported - English Label',
  'Imported - Non-English Label',
];

export const ASK_US_VENDOR_TYPES = new Set([
  'House-Made', 'Local Artisan', 'Imported - Non-English Label',
]);

// OFF tag fragment -> our allergen key (mirror of server/allergens.js).
const OFF_TAG_MAP = {
  milk: 'milk', eggs: 'eggs', egg: 'eggs', fish: 'fish',
  crustaceans: 'shellfish', molluscs: 'shellfish', shellfish: 'shellfish',
  'tree-nuts': 'tree_nuts', nuts: 'tree_nuts', peanuts: 'peanuts',
  wheat: 'wheat', soybeans: 'soybeans', soya: 'soybeans', soy: 'soybeans',
  sesame: 'sesame', 'sesame-seeds': 'sesame', gluten: 'gluten',
};

export function tagsToFlags(tags) {
  const flags = {};
  (tags || []).forEach((raw) => {
    const frag = String(raw).split(':').pop().trim().toLowerCase();
    const key = OFF_TAG_MAP[frag];
    if (key) flags[key] = true;
  });
  return flags;
}

// Human-readable list from OFF traces tags, for the voluntary disclaimers field.
export function tagsToText(tags) {
  if (!tags || !tags.length) return '';
  const names = tags.map((t) => String(t).split(':').pop().replace(/-/g, ' ').trim());
  return `May contain: ${names.join(', ')}.`;
}
