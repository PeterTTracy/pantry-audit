import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

import { parseImportRows, extractUnit, findHeaderRow, normalizeGtin } from '../src/lib/importParse.js';
import { computeCompliance } from '../src/lib/compliance.js';
import { buildExportSheets, sheetName } from '../src/lib/exportRows.js';
import { tagsToFlags, tagsToText } from '../src/allergens.js';
import { innerGtin13 } from '../src/lib/off.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function sampleRows() {
  const csv = fs.readFileSync(path.join(here, '..', 'samples', 'sample_myorders_export.csv'));
  const wb = XLSX.read(csv, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' });
}

// ---- import parsing ---------------------------------------------------------

test('extracts unit name and COMPASS id from the sample export', () => {
  const { unit } = parseImportRows(sampleRows());
  assert.strictEqual(unit.unit_name, 'MIT Forbes Family Cafe');
  assert.strictEqual(unit.compass_id, 'COMPASS-44873');
});

test('parses all sample rows with correct scope classification', () => {
  const { items, skipped } = parseImportRows(sampleRows());
  assert.strictEqual(items.length, 10);
  assert.strictEqual(skipped, 0);

  const outOfScope = items.filter((i) => i.audit_scope === 0);
  // Produce Walk-in, Paper Goods, Chemical Room, DO NOT INVENTORY
  assert.strictEqual(outOfScope.length, 4);

  const cheezIt = items.find((i) => i.item_description.startsWith('Cheez-It'));
  assert.strictEqual(cheezIt.distributor_sku, 'USF-880421');
  assert.strictEqual(cheezIt.gtin, '0024100110056');
  assert.strictEqual(cheezIt.audit_scope, 1);
});

test('falls back to SEQ / description for a stable SKU when Dist # is blank', () => {
  const rows = [
    ['My Cafe (COMPASS-1)'],
    ['Classification', 'Seq', 'Item Description', 'Dist #'],
    ['Dry Storage', '7', 'Mystery Beans', ''],
    ['Dry Storage', '', 'No Seq Either', ''],
  ];
  const { items } = parseImportRows(rows);
  assert.strictEqual(items[0].distributor_sku, 'SEQ-7');
  assert.match(items[1].distributor_sku, /^DESC-No Seq Either/);
});

test('parses real MyOrders format: "Grouped by:" header prefix and hierarchical rooms', () => {
  const rows = [
    [''],
    ['MIT New Vassar (COMPASS-55692)'],
    ['Printed By: TracyP01-3001'],
    ['Grouped by: Classification', 'Seq', 'Item Description', 'Brand', 'Category', 'Distributor', 'Distribution Center', 'Dist #', 'Pack Type', 'Price Type', 'Price', 'Attributes', 'Status', 'UOM', 'Last Inventory Qty', 'Mfg', 'Mfg #', 'GTIN', 'Customer #'],
    ['Store Room', '1', 'PAN COATING ARSL GRL CANOLA', 'PAM', 'ARSL/PAN COAT', 'Sysco Corporation', 'SYSCO BOSTON', '3500039', 'CS', '', '', '', 'Active', 'CS', '1', 'ConAgra', 'CA-1', '20064144322767', 'C-1'],
    ['Walk-in fridge->Dairy', '2', 'MILK WHOLE GAL', 'HOOD', 'DAIRY', 'Sysco Corporation', 'SYSCO BOSTON', '1234567', 'EA', '', '', '', 'Active', 'EA', '4', 'Hood', 'H-1', '00044100117777', 'C-1'],
    ['Paper / hallway', '3', 'PLATE PAPER 9IN', 'DIXIE', 'DISPOSABLES', 'Sysco Corporation', 'SYSCO BOSTON', '7654321', 'CS', '', '', '', 'Active', 'CS', '2', 'Dixie', 'D-1', '', 'C-1'],
    ['Chemical->mop room', '4', 'DEGREASER HD', 'ECOLAB', 'CLEANING', 'Sysco Corporation', 'SYSCO BOSTON', '1111111', 'EA', '', '', '', 'Active', 'EA', '1', 'Ecolab', 'E-1', '', 'C-1'],
    ['Unassigned', '5', 'PASTA PENNE', 'BARILLA', 'DRY', 'Sysco Corporation', 'SYSCO BOSTON', '2222222', 'CS', '', '', '', 'Active', 'CS', '3', 'Barilla', 'B-1', '10076808514978', 'C-1'],
    ['DO NOT INVENTROY', '6', 'DISPLAY BASKET', 'HOUSE', 'MISC', 'Local', 'N/A', '3333333', 'EA', '', '', '', 'Active', 'EA', '1', 'N/A', 'N/A', '', 'C-1'],
  ];
  const { unit, items, buckets } = parseImportRows(rows);
  assert.strictEqual(unit.unit_name, 'MIT New Vassar');
  assert.strictEqual(unit.compass_id, 'COMPASS-55692');
  assert.strictEqual(items.length, 6);

  const byDesc = Object.fromEntries(items.map((i) => [i.item_description, i]));
  assert.strictEqual(byDesc['PAN COATING ARSL GRL CANOLA'].scope_reason, 'single_ingredient');
  assert.strictEqual(byDesc['MILK WHOLE GAL'].audit_scope, 1);
  assert.strictEqual(byDesc['MILK WHOLE GAL'].storage_location, 'Walk-in fridge->Dairy');
  assert.strictEqual(byDesc['PLATE PAPER 9IN'].scope_reason, 'non_food');
  assert.strictEqual(byDesc['DEGREASER HD'].scope_reason, 'non_food');
  assert.strictEqual(byDesc['PASTA PENNE'].scope_reason, 'single_ingredient', 'plain pasta is a single-ingredient staple');
  assert.strictEqual(byDesc['DISPLAY BASKET'].scope_reason, 'do_not_inventory', 'DO NOT INVENTROY typo');
  assert.deepStrictEqual(buckets, { non_food: 2, do_not_inventory: 1, zero_qty: 0, single_ingredient: 2 });
  // 14-digit GTINs pass through untouched
  assert.strictEqual(byDesc['MILK WHOLE GAL'].gtin, '00044100117777');
});

test('deduplicates repeated SKUs: first wins, real room beats Unassigned', () => {
  const rows = [
    ['My Cafe (COMPASS-1)'],
    ['Classification', 'Seq', 'Item Description', 'Dist #'],
    // same SKU three times: Unassigned first, then a real room, then another room
    ['Unassigned', '1', 'Olive Oil', 'SKU-1'],
    ['Dry Storage', '2', 'Olive Oil', 'SKU-1'],
    ['Walk-in Cooler', '3', 'Olive Oil', 'SKU-1'],
    // same SKU twice, both real rooms: first wins
    ['Freezer', '4', 'Chicken Breast', 'SKU-2'],
    ['Walk-in Cooler', '5', 'Chicken Breast', 'SKU-2'],
    // unique SKU untouched
    ['Dry Storage', '6', 'Penne', 'SKU-3'],
  ];
  const { items, duplicates } = parseImportRows(rows);
  assert.strictEqual(items.length, 3);
  assert.strictEqual(duplicates, 3);
  const byDesc = Object.fromEntries(items.map((i) => [i.item_description, i]));
  assert.strictEqual(byDesc['Olive Oil'].storage_location, 'Dry Storage', 'real room replaces Unassigned, first real room wins');
  assert.strictEqual(byDesc['Chicken Breast'].storage_location, 'Freezer', 'first occurrence wins');
});

test('restores GTIN leading zeros lost to number parsing', () => {
  assert.strictEqual(normalizeGtin(24100110056), '0024100110056'); // numeric cell
  assert.strictEqual(normalizeGtin('0024100110056'), '0024100110056'); // already text
  assert.strictEqual(normalizeGtin('12345678'), '12345678'); // EAN-8 untouched
  assert.strictEqual(normalizeGtin('10024100110056'), '10024100110056'); // GTIN-14 untouched
  assert.strictEqual(normalizeGtin(''), null);
  assert.strictEqual(normalizeGtin('N/A'), null);
});

test('throws clear errors for unusable files', () => {
  assert.throws(() => parseImportRows([['just', 'noise']]), /COMPASS/);
  assert.throws(() => parseImportRows([['My Cafe (COMPASS-9)'], ['no', 'headers']]), /header row/);
  assert.strictEqual(extractUnit([['Forbes (COMPASS-44873)']]).compass_id, 'COMPASS-44873');
  assert.strictEqual(findHeaderRow([['x'], ['classification', 'item description']]), 1);
});

// ---- compliance aggregation ---------------------------------------------------

const PRODUCTS = [
  { id: 1, unit_name: 'Cafe A', compass_id: 'COMPASS-1', storage_location: 'Dry', item_description: 'Crackers', brand: 'B1', audit_scope: 1, audit_status: 'complete' },
  { id: 2, unit_name: 'Cafe A', compass_id: 'COMPASS-1', storage_location: 'Dry', item_description: 'Pasta', brand: 'B2', audit_scope: 1, audit_status: 'pending' },
  { id: 3, unit_name: 'Cafe A', compass_id: 'COMPASS-1', storage_location: 'Dry', item_description: 'Napkins', brand: 'B3', audit_scope: 0, audit_status: 'pending' },
  { id: 4, unit_name: 'Cafe B', compass_id: 'COMPASS-2', storage_location: 'Cooler', item_description: 'Cheese', brand: 'B4', audit_scope: 1, audit_status: 'complete' },
];
const AUDITS = [
  { product_id: 1, ask_us_flag: 0, review_due: '2026-01-01', reviewed_by: 'Dana', vendor_type: 'FDA Packaged' },
  { product_id: 4, ask_us_flag: 1, review_due: '2099-01-01', reviewed_by: 'Marcus', vendor_type: 'House-Made' },
];

test('compliance summary counts scope items per unit', () => {
  const { summary } = computeCompliance(PRODUCTS, AUDITS, '2026-06-10');
  assert.deepStrictEqual(
    summary.map((s) => [s.unit_name, s.total, s.complete, s.pct_complete]),
    [['Cafe A', 2, 1, 50], ['Cafe B', 1, 1, 100]]
  );
});

test('compliance flags overdue and ask-us items', () => {
  const { overdue, askUs } = computeCompliance(PRODUCTS, AUDITS, '2026-06-10');
  assert.strictEqual(overdue.length, 1);
  assert.strictEqual(overdue[0].item_description, 'Crackers');
  assert.strictEqual(askUs.length, 1);
  assert.strictEqual(askUs[0].item_description, 'Cheese');
});

// ---- export rows -------------------------------------------------------------

test('export builds one sheet per unit, scope items only', () => {
  const photosByProduct = new Map([
    [1, [{ id: 10, name: 'label.jpg', source: 'upload', sort: 0 }]],
    // Cheese (product 4): out of sort order, and a captured shot with no filename.
    [4, [
      { id: 21, name: null, source: 'workbook', sort: 1 },
      { id: 20, name: 'front.jpg', source: 'camera', sort: 0 },
    ]],
  ]);
  const sheets = buildExportSheets(PRODUCTS, AUDITS, photosByProduct);
  assert.deepStrictEqual(sheets.map((s) => s.sheet), ['Cafe A', 'Cafe B']);
  assert.strictEqual(sheets[0].rows.length, 2); // napkins (out of scope) excluded
  const crackers = sheets[0].rows.find((r) => r['Item Description'] === 'Crackers');
  assert.strictEqual(crackers['Photo Count'], 1);
  assert.strictEqual(crackers['Label Photos'], 'label.jpg');
  assert.strictEqual(crackers['Vendor Type'], 'FDA Packaged');
  const pasta = sheets[0].rows.find((r) => r['Item Description'] === 'Pasta');
  assert.strictEqual(pasta['Milk'], 'No'); // unaudited rows still export with No flags
  assert.strictEqual(pasta['Photo Count'], 0);
  assert.strictEqual(pasta['Label Photos'], ''); // no photos -> empty cell
  // All photos are listed, ordered by sort; a nameless capture falls back to a numbered source label.
  const cheese = sheets[1].rows.find((r) => r['Item Description'] === 'Cheese');
  assert.strictEqual(cheese['Photo Count'], 2);
  assert.strictEqual(cheese['Label Photos'], 'front.jpg; workbook 2');
});

test('sheet names are deduplicated and sanitized', () => {
  const used = new Set();
  assert.strictEqual(sheetName('Cafe: A/B', used), 'Cafe  A B');
  assert.strictEqual(sheetName('Cafe: A/B', used), 'Cafe  A B 2');
  assert.strictEqual(sheetName('X'.repeat(40), used).length <= 31, true);
});

// ---- cleaner rule buckets (ported from clean_inventory.py) --------------------------

const HDR = ['Classification', 'Seq', 'Item Description', 'Brand', 'Category', 'Distributor', 'DC', 'Dist #', 'PT', 'PrT', 'Pr', 'At', 'St', 'UOM', 'Last Inventory Qty', 'Mfg', 'Mfg #', 'GTIN', 'Customer #'];
const mkRow = (cls, desc, { cat = '', dist = '', qty = '1.00 CS', mfgNum = '', gtin = '', cust = '', seq = '' } = {}) =>
  [cls, seq, desc, 'B', cat, 'Sysco', 'DC', dist, '', '', '', '', '', '', qty, 'M', mfgNum, gtin, cust];
const parse = (rows) => parseImportRows([['My Cafe (COMPASS-1)'], HDR, ...rows]);

test('FOOD_GUARD protects food-in-a-vessel from non-food keywords', () => {
  const { items } = parse([
    mkRow('Dry', 'CUP PAPER HOT 12OZ', { dist: '1' }),
    mkRow('Dry', 'PEANUT BUTTER CUP 12CT', { dist: '2' }),
    mkRow('Dry', 'WRAP TORTILLA FLOUR 12IN', { dist: '3' }),
    mkRow('Dry', 'FOIL ROLL 18IN', { dist: '4' }),
  ]);
  const by = Object.fromEntries(items.map((i) => [i.item_description, i.scope_reason]));
  assert.strictEqual(by['CUP PAPER HOT 12OZ'], 'non_food');
  assert.strictEqual(by['PEANUT BUTTER CUP 12CT'], null);
  assert.strictEqual(by['WRAP TORTILLA FLOUR 12IN'], null);
  assert.strictEqual(by['FOIL ROLL 18IN'], 'non_food');
});

test('category-based non-food and zero-quantity exclusion', () => {
  const { items, buckets } = parse([
    mkRow('Dry', 'GENERIC ITEM', { cat: 'CUPS PAPER', dist: '1' }),
    mkRow('Dry', 'SOUP CHICKEN NDL', { dist: '2', qty: '0.00 CS/0.00 EA' }),
    mkRow('Dry', 'SOUP TOMATO BISQUE', { dist: '3', qty: '0.00 CS/2.00 EA' }),
  ]);
  const by = Object.fromEntries(items.map((i) => [i.item_description, i.scope_reason]));
  assert.strictEqual(by['GENERIC ITEM'], 'non_food');
  assert.strictEqual(by['SOUP CHICKEN NDL'], 'zero_qty');
  assert.strictEqual(by['SOUP TOMATO BISQUE'], null, 'stock in any unit keeps the item');
  assert.strictEqual(buckets.zero_qty, 1);
});

test('SINGLE_KEEP protects blends and processed items from the single-ingredient rule', () => {
  const { items } = parse([
    mkRow('Dry', 'FLOUR AP UNBLEACHED 50LB', { dist: '1' }),
    mkRow('Dry', 'SPICE CUMIN GROUND', { dist: '2' }),
    mkRow('Dry', 'SPICE SEASONING CAJUN', { dist: '3' }),
    mkRow('Dry', 'CHEESE AMERICAN SLICED', { dist: '4' }),
  ]);
  const by = Object.fromEntries(items.map((i) => [i.item_description, i.scope_reason]));
  assert.strictEqual(by['FLOUR AP UNBLEACHED 50LB'], 'single_ingredient');
  assert.strictEqual(by['SPICE CUMIN GROUND'], 'single_ingredient');
  assert.strictEqual(by['SPICE SEASONING CAJUN'], null, 'SEASONING is kept');
  assert.strictEqual(by['CHEESE AMERICAN SLICED'], null, 'AMERICAN (processed) is kept');
});

test('SKU key chain falls back Dist # > Customer # > GTIN > Mfg #', () => {
  const { items, duplicates } = parse([
    mkRow('Dry', 'ITEM A', { dist: '111' }),
    mkRow('Dry', 'ITEM B', { cust: '222' }),
    mkRow('Dry', 'ITEM C', { gtin: '0024100110056' }),
    mkRow('Dry', 'ITEM D', { mfgNum: '333' }),
    mkRow('Cooler', 'ITEM C DUP', { gtin: '0024100110056' }), // same GTIN -> duplicate
  ]);
  const skus = Object.fromEntries(items.map((i) => [i.item_description, i.distributor_sku]));
  assert.strictEqual(skus['ITEM A'], '111');
  assert.strictEqual(skus['ITEM B'], 'C:222');
  assert.strictEqual(skus['ITEM C'], 'G:0024100110056');
  assert.strictEqual(skus['ITEM D'], 'M:333');
  assert.strictEqual(duplicates, 1);
});

// ---- GS1 case code -> consumer code ----------------------------------------------

test('derives the consumer GTIN-13 from a 14-digit case code', () => {
  // Indicator 0: contained code is just the last 13 digits (check digit unchanged).
  assert.strictEqual(innerGtin13('00024100110056'), '0024100110056');
  // Indicator 2 (PAM case code): check digit must be recomputed.
  assert.strictEqual(innerGtin13('20064144322767'), '0064144322763');
  // Round-trip property: result is a valid EAN-13 (its own check digit verifies).
  const ean = innerGtin13('10013000652008');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(ean[i]) * (i % 2 === 0 ? 1 : 3);
  assert.strictEqual(Number(ean[12]), (10 - (sum % 10)) % 10);
});

// ---- allergen tag mapping ------------------------------------------------------

test('maps Open Food Facts tags to allergen flags', () => {
  const flags = tagsToFlags(['en:gluten', 'en:milk', 'en:tree-nuts', 'en:crustaceans', 'en:unknown-thing']);
  assert.deepStrictEqual(flags, { gluten: true, milk: true, tree_nuts: true, shellfish: true });
  assert.strictEqual(tagsToText(['en:soybeans', 'en:tree-nuts']), 'May contain: soybeans, tree nuts.');
});
