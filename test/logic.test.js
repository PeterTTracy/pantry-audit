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

// ---- allergen tag mapping ------------------------------------------------------

test('maps Open Food Facts tags to allergen flags', () => {
  const flags = tagsToFlags(['en:gluten', 'en:milk', 'en:tree-nuts', 'en:crustaceans', 'en:unknown-thing']);
  assert.deepStrictEqual(flags, { gluten: true, milk: true, tree_nuts: true, shellfish: true });
  assert.strictEqual(tagsToText(['en:soybeans', 'en:tree-nuts']), 'May contain: soybeans, tree nuts.');
});
