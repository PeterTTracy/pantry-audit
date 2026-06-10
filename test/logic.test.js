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
  const { unit, items } = parseImportRows(rows);
  assert.strictEqual(unit.unit_name, 'MIT New Vassar');
  assert.strictEqual(unit.compass_id, 'COMPASS-55692');
  assert.strictEqual(items.length, 6);

  const byDesc = Object.fromEntries(items.map((i) => [i.item_description, i]));
  assert.strictEqual(byDesc['PAN COATING ARSL GRL CANOLA'].audit_scope, 1);
  assert.strictEqual(byDesc['MILK WHOLE GAL'].audit_scope, 1);
  assert.strictEqual(byDesc['MILK WHOLE GAL'].storage_location, 'Walk-in fridge->Dairy');
  assert.strictEqual(byDesc['PLATE PAPER 9IN'].audit_scope, 0, 'Paper / hallway is out of scope');
  assert.strictEqual(byDesc['DEGREASER HD'].audit_scope, 0, 'Chemical->mop room is out of scope');
  assert.strictEqual(byDesc['PASTA PENNE'].audit_scope, 1);
  assert.strictEqual(byDesc['DISPLAY BASKET'].audit_scope, 0, 'DO NOT INVENTROY typo is out of scope');
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
  const sheets = buildExportSheets(PRODUCTS, AUDITS, new Map([[1, 'label.jpg']]));
  assert.deepStrictEqual(sheets.map((s) => s.sheet), ['Cafe A', 'Cafe B']);
  assert.strictEqual(sheets[0].rows.length, 2); // napkins (out of scope) excluded
  const crackers = sheets[0].rows.find((r) => r['Item Description'] === 'Crackers');
  assert.strictEqual(crackers['Label Photo Filename'], 'label.jpg');
  assert.strictEqual(crackers['Vendor Type'], 'FDA Packaged');
  const pasta = sheets[0].rows.find((r) => r['Item Description'] === 'Pasta');
  assert.strictEqual(pasta['Milk'], 'No'); // unaudited rows still export with No flags
});

test('sheet names are deduplicated and sanitized', () => {
  const used = new Set();
  assert.strictEqual(sheetName('Cafe: A/B', used), 'Cafe  A B');
  assert.strictEqual(sheetName('Cafe: A/B', used), 'Cafe  A B 2');
  assert.strictEqual(sheetName('X'.repeat(40), used).length <= 31, true);
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
