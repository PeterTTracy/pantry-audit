const express = require('express');
const XLSX = require('xlsx');
const db = require('../db');
const { importUpload } = require('../uploads');
const { runPrefillForUnit } = require('../openfoodfacts');

const router = express.Router();

// Classifications that should NOT be in audit scope.
const OUT_OF_SCOPE = new Set([
  'do not inventory', 'paper goods', 'paper room', 'chemical room', 'cleaning',
]);
// Single-ingredient produce classification.
const PRODUCE = 'produce walk-in';

const norm = (s) => String(s == null ? '' : s).trim();

// Locate the COMPASS unit string anywhere in the first few rows.
function extractUnit(rows) {
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    for (const cell of rows[i] || []) {
      const m = String(cell || '').match(/^(.*?)\s*\((COMPASS-\d+)\)\s*$/i);
      if (m) return { unit_name: m[1].trim(), compass_id: m[2].toUpperCase() };
    }
  }
  return null;
}

// Find the header row index by locating the row that contains "Item Description".
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const cells = (rows[i] || []).map((c) => norm(c).toLowerCase());
    if (cells.includes('item description') && cells.includes('classification')) return i;
  }
  return -1;
}

router.post('/import', importUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  let rows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
  } catch (err) {
    return res.status(400).json({ error: `Could not parse file: ${err.message}` });
  }

  const unit = extractUnit(rows);
  if (!unit) {
    return res.status(400).json({
      error: 'Could not find a unit name with a (COMPASS-#####) tag in the first rows of the file.',
    });
  }

  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) {
    return res.status(400).json({
      error: 'Could not find a header row containing "Classification" and "Item Description".',
    });
  }

  const header = (rows[headerIdx] || []).map((c) => norm(c).toLowerCase());
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

  const upsert = db.prepare(`
    INSERT INTO products
      (unit_name, compass_id, storage_location, item_description, brand,
       distributor, distributor_sku, gtin, manufacturer, audit_scope, audit_status)
    VALUES
      (@unit_name, @compass_id, @storage_location, @item_description, @brand,
       @distributor, @distributor_sku, @gtin, @manufacturer, @audit_scope, 'pending')
    ON CONFLICT(unit_name, distributor_sku) DO UPDATE SET
      compass_id       = excluded.compass_id,
      storage_location = excluded.storage_location,
      item_description = excluded.item_description,
      brand            = excluded.brand,
      distributor      = excluded.distributor,
      gtin             = excluded.gtin,
      manufacturer     = excluded.manufacturer,
      audit_scope      = excluded.audit_scope
      -- audit_status and gtin_prefill are intentionally left untouched.
  `);

  let inserted = 0, updated = 0, skipped = 0, outOfScope = 0;

  const existsStmt = db.prepare(
    'SELECT id FROM products WHERE unit_name = ? AND distributor_sku = ?'
  );

  const tx = db.transaction(() => {
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const description = norm(row[idx.description]);
      if (!description) { skipped++; continue; }

      const classification = norm(idx.classification >= 0 ? row[idx.classification] : '');
      const clsLower = classification.toLowerCase();
      const distNum = idx.dist_num >= 0 ? norm(row[idx.dist_num]) : '';
      const seq = idx.seq >= 0 ? norm(row[idx.seq]) : '';
      // Stable key even when Dist # is blank.
      const sku = distNum || (seq ? `SEQ-${seq}` : `DESC-${description}`.slice(0, 60));

      const inScope = !(OUT_OF_SCOPE.has(clsLower) || clsLower === PRODUCE);

      const before = existsStmt.get(unit.unit_name, sku);
      upsert.run({
        unit_name: unit.unit_name,
        compass_id: unit.compass_id,
        storage_location: classification || 'Unassigned',
        item_description: description,
        brand: idx.brand >= 0 ? norm(row[idx.brand]) : '',
        distributor: idx.distributor >= 0 ? norm(row[idx.distributor]) : '',
        distributor_sku: sku,
        gtin: idx.gtin >= 0 ? norm(row[idx.gtin]) || null : null,
        manufacturer: idx.mfg >= 0 ? norm(row[idx.mfg]) : '',
        audit_scope: inScope ? 1 : 0,
      });
      if (before) updated++; else inserted++;
      if (!inScope) outOfScope++;
    }
  });
  tx();

  // Kick off Open Food Facts prefill in the background; don't block the response.
  runPrefillForUnit(unit.unit_name)
    .then((n) => console.log(`[import] prefill attempted for ${n} pending GTIN products in "${unit.unit_name}".`))
    .catch((e) => console.warn('[import] prefill batch error:', e.message));

  res.json({
    ok: true,
    unit_name: unit.unit_name,
    compass_id: unit.compass_id,
    inserted, updated, skipped, out_of_scope: outOfScope,
  });
});

module.exports = router;
