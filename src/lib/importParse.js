// Pure MyOrders-export parsing, shared by the app and the node:test suite.
// Takes a sheet as an array of row arrays (XLSX.utils.sheet_to_json header:1).
import { scopeReason, qtyTotal } from './scopeRules.js';

const norm = (s) => String(s == null ? '' : s).trim();

// MyOrders prefixes the grouping column's header with the report's grouping
// label, e.g. "Grouped by: Classification" -> "classification".
const headerName = (s) => norm(s).toLowerCase().replace(/^[a-z ]+ by:\s*/, '');

// Spreadsheets often store GTINs as numbers, dropping leading zeros
// (0024100110056 -> 24100110056), which breaks barcode lookups. Zero-pad
// short codes to EAN-13; leave EAN-8 and GTIN-14 untouched.
export function normalizeGtin(value) {
  const digits = norm(value).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length > 8 && digits.length < 13) return digits.padStart(13, '0');
  return digits;
}

// Locate the COMPASS unit string anywhere in the first few rows.
export function extractUnit(rows) {
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    for (const cell of rows[i] || []) {
      const m = String(cell || '').match(/^(.*?)\s*\((COMPASS-\d+)\)\s*$/i);
      if (m) return { unit_name: m[1].trim(), compass_id: m[2].toUpperCase() };
    }
  }
  return null;
}

// Find the header row index by locating the row that contains "Item Description".
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const cells = (rows[i] || []).map(headerName);
    if (cells.includes('item description') && cells.includes('classification')) return i;
  }
  return -1;
}

// Duplicate-SKU key: first non-blank of Dist # > Customer # > GTIN > Mfg #.
// Dist # stays unprefixed so existing devices' products keep matching on
// re-import; the alternates are prefixed so different ID types never collide.
function skuFor({ distNum, customer, gtin, mfgNum, seq, description }) {
  if (distNum) return distNum;
  if (customer) return `C:${customer}`;
  if (gtin) return `G:${gtin}`;
  if (mfgNum) return `M:${mfgNum}`;
  if (seq) return `SEQ-${seq}`;
  return `DESC-${description}`.slice(0, 60);
}

// When the same SKU appears in several rows, keep the best one:
// in-audit-scope beats out-of-scope, then a real room beats 'Unassigned'.
function betterRow(candidate, kept) {
  const keptIn = kept.scope_reason === null;
  const candIn = candidate.scope_reason === null;
  if (candIn !== keptIn) return candIn;
  const keptUn = kept.storage_location === 'Unassigned';
  const candUn = candidate.storage_location === 'Unassigned';
  if (candUn !== keptUn) return keptUn;
  return false; // first occurrence wins
}

// Parse the full sheet. Returns { unit, items, skipped, duplicates, buckets }
// or throws with a user-facing message.
export function parseImportRows(rows) {
  const unit = extractUnit(rows);
  if (!unit) {
    throw new Error('Could not find a unit name with a (COMPASS-#####) tag in the first rows of the file.');
  }

  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) {
    throw new Error('Could not find a header row containing "Classification" and "Item Description".');
  }

  const header = (rows[headerIdx] || []).map(headerName);
  const col = (name) => header.indexOf(name.toLowerCase());
  const idx = {
    classification: col('classification'),
    seq: col('seq'),
    description: col('item description'),
    brand: col('brand'),
    category: col('category'),
    distributor: col('distributor'),
    dist_num: col('dist #'),
    mfg: col('mfg'),
    mfg_num: col('mfg #'),
    gtin: col('gtin'),
    customer: col('customer #'),
    qty: col('last inventory qty'),
  };
  const cell = (row, i) => (i >= 0 ? norm(row[i]) : '');

  const byKey = new Map();
  let skipped = 0;
  let duplicates = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const description = cell(row, idx.description);
    if (!description) { skipped++; continue; }

    const classification = cell(row, idx.classification);
    const clsTop = classification.toLowerCase().split('->')[0].trim();
    const category = cell(row, idx.category);
    const gtin = idx.gtin >= 0 ? normalizeGtin(row[idx.gtin]) : null;
    const qty = idx.qty >= 0 ? qtyTotal(cell(row, idx.qty)) : null;

    const sku = skuFor({
      distNum: cell(row, idx.dist_num),
      customer: cell(row, idx.customer),
      gtin,
      mfgNum: cell(row, idx.mfg_num),
      seq: cell(row, idx.seq),
      description,
    });

    const reason = scopeReason({ description, clsTop, category, qty });

    const item = {
      unit_name: unit.unit_name,
      compass_id: unit.compass_id,
      storage_location: classification || 'Unassigned',
      item_description: description,
      brand: cell(row, idx.brand),
      distributor: cell(row, idx.distributor),
      distributor_sku: sku,
      gtin,
      manufacturer: cell(row, idx.mfg),
      audit_scope: reason === null ? 1 : 0,
      scope_reason: reason,
      qty_total: qty,
    };

    const prev = byKey.get(sku);
    if (!prev) {
      byKey.set(sku, item);
    } else {
      duplicates++;
      if (betterRow(item, prev)) byKey.set(sku, item);
    }
  }

  const items = [...byKey.values()];
  const buckets = { non_food: 0, do_not_inventory: 0, zero_qty: 0, single_ingredient: 0 };
  for (const it of items) {
    if (it.scope_reason) buckets[it.scope_reason]++;
  }

  return { unit, items, skipped, duplicates, buckets };
}
