// Pure MyOrders-export parsing, shared by the app and the node:test suite.
// Takes a sheet as an array of row arrays (XLSX.utils.sheet_to_json header:1).

// Non-food classifications are out of audit scope. Real MyOrders exports use
// site-specific names ("Paper / hallway", "Chemical->mop room"), so match on
// the leading keyword of the top-level segment rather than exact names.
// 'do not invent' catches both "DO NOT INVENTORY" and the "DO NOT INVENTROY"
// typo that ships in real MyOrders data.
const OUT_OF_SCOPE_PREFIXES = ['do not invent', 'paper', 'chemical', 'cleaning'];
// Single-ingredient produce classification.
const PRODUCE = 'produce walk-in';

function isOutOfScope(classification) {
  // Hierarchical classifications look like "Chemical->mop room"; scope is
  // decided by the top-level segment.
  const top = classification.toLowerCase().split('->')[0].trim();
  return top === PRODUCE || OUT_OF_SCOPE_PREFIXES.some((p) => top.startsWith(p));
}

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

// Parse the full sheet. Returns { unit, items, skipped } or throws with a
// user-facing message.
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
    distributor: col('distributor'),
    dist_num: col('dist #'),
    mfg: col('mfg'),
    gtin: col('gtin'),
  };

  const items = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const description = norm(row[idx.description]);
    if (!description) { skipped++; continue; }

    const classification = norm(idx.classification >= 0 ? row[idx.classification] : '');
    const distNum = idx.dist_num >= 0 ? norm(row[idx.dist_num]) : '';
    const seq = idx.seq >= 0 ? norm(row[idx.seq]) : '';
    // Stable key even when Dist # is blank.
    const sku = distNum || (seq ? `SEQ-${seq}` : `DESC-${description}`.slice(0, 60));

    const inScope = !isOutOfScope(classification);

    items.push({
      unit_name: unit.unit_name,
      compass_id: unit.compass_id,
      storage_location: classification || 'Unassigned',
      item_description: description,
      brand: idx.brand >= 0 ? norm(row[idx.brand]) : '',
      distributor: idx.distributor >= 0 ? norm(row[idx.distributor]) : '',
      distributor_sku: sku,
      gtin: idx.gtin >= 0 ? normalizeGtin(row[idx.gtin]) : null,
      manufacturer: idx.mfg >= 0 ? norm(row[idx.mfg]) : '',
      audit_scope: inScope ? 1 : 0,
    });
  }

  return { unit, items, skipped };
}
