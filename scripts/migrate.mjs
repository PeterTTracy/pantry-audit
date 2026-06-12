// One-off migration: wipe the pantry-audit cloud and reload it from the
// "Visual Ingredient Book.xlsx" workbook (one sheet per MIT house, plus an
// "Orphans" photo-staging sheet). Reuses the app's own scope rules so the
// derived audit-scope / scope_reason exactly match the in-app importer.
//
//   Dry run (default): parse + print a per-unit summary, touch nothing.
//   Apply:  APPLY=1 node scripts/migrate.mjs   (wipes ALL cloud data first)
//
// Env: BOOK_PATH=<path to xlsx>  [APPLY=1]
import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { scopeReason, qtyTotal } from '../src/lib/scopeRules.js';
import { normalizeGtin } from '../src/lib/importParse.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../src/lib/supabase.js';

const BOOK = process.env.BOOK_PATH;
const APPLY = process.env.APPLY === '1';
// The book is a curated photo/ingredient reference, not a live inventory count,
// so most "Last Inventory Qty" cells are 0. Passing qty=null to scopeReason
// disables ONLY the zero_qty exclusion (its documented escape hatch) while
// keeping non_food / single_ingredient / do_not_inventory filtering intact.
const IGNORE_ZERO_QTY = process.env.IGNORE_ZERO_QTY === '1';
if (!BOOK) { console.error('Set BOOK_PATH'); process.exit(1); }

const norm = (s) => String(s == null ? '' : s).trim();
const CHUNK = 500;
const chunked = (arr, n = CHUNK) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

// --- SKU + dedup logic, copied verbatim from src/lib/importParse.js ----------
function skuFor({ distNum, customer, gtin, mfgNum, seq, description }) {
  if (distNum) return distNum;
  if (customer) return `C:${customer}`;
  if (gtin) return `G:${gtin}`;
  if (mfgNum) return `M:${mfgNum}`;
  if (seq) return `SEQ-${seq}`;
  return `DESC-${description}`.slice(0, 60);
}
function betterRow(candidate, kept) {
  const keptIn = kept.scope_reason === null;
  const candIn = candidate.scope_reason === null;
  if (candIn !== keptIn) return candIn;
  const keptUn = kept.storage_location === 'Unassigned';
  const candUn = candidate.storage_location === 'Unassigned';
  if (candUn !== keptUn) return keptUn;
  return false;
}

// --- workbook ----------------------------------------------------------------
// sheetRows caps the parse so Vassar's bogus 1,048,576-row !ref can't OOM us.
const wb = XLSX.read(readFileSync(BOOK), { type: 'buffer', raw: true, sheetRows: 5000, dense: true });
const sheetRows = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '' });

// Sheets that follow the standard MyOrders column layout.
const STD = ['Baker', 'Forbes', 'Masseh', 'Next', 'Simmons', 'Vassar'];
const ALLERGEN_KEYS = ['milk', 'eggs', 'fish', 'shellfish', 'tree_nuts', 'peanuts', 'wheat', 'soybeans', 'sesame', 'gluten'];
// Vassar header -> our allergen key.
const VASSAR_ALLERGEN = { Eggs: 'eggs', Milk: 'milk', Fish: 'fish', Peanuts: 'peanuts', Sesame: 'sesame', Shellfish: 'shellfish', Soy: 'soybeans', 'Tree Nuts': 'tree_nuts', Wheat: 'wheat' };

function colMap(header) {
  const h = header.map((c) => norm(c).toLowerCase());
  return (name) => h.indexOf(name.toLowerCase());
}

// Parse one standard-layout sheet (incl. Vassar) into { items, audits }.
function parseStandard(name) {
  const rows = sheetRows(name);
  const header = rows[0];
  const col = colMap(header);
  const idx = {
    classification: col('classification'), seq: col('seq'), description: col('item description'),
    brand: col('brand'), category: col('category'), distributor: col('distributor'),
    dist_num: col('dist #'), mfg: col('mfg'), mfg_num: col('mfg #'), gtin: col('gtin'),
    customer: col('customer #'), qty: col('last inventory qty'), verified: col('verified?'),
    voluntary: col('voluntary disclaimers'), reviewed_by: col('reviewed by'), date_reviewed: col('date reviewed'),
  };
  const cell = (row, i) => (i >= 0 ? norm(row[i]) : '');
  const byKey = new Map();
  const auditByKey = new Map();
  let skipped = 0, duplicates = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const description = cell(row, idx.description);
    if (!description) { skipped++; continue; }
    const classification = cell(row, idx.classification);
    const clsTop = classification.toLowerCase().split('->')[0].trim();
    const category = cell(row, idx.category);
    const gtin = idx.gtin >= 0 ? normalizeGtin(row[idx.gtin]) : null;
    const qty = idx.qty >= 0 ? qtyTotal(cell(row, idx.qty)) : null;
    const sku = skuFor({
      distNum: cell(row, idx.dist_num), customer: cell(row, idx.customer), gtin,
      mfgNum: cell(row, idx.mfg_num), seq: cell(row, idx.seq), description,
    });
    const reason = scopeReason({ description, clsTop, category, qty: IGNORE_ZERO_QTY ? null : qty });

    // Vassar-only: a "Verified?" = TRUE row carries an (allergen) audit record.
    let verified = false, audit = null;
    if (name === 'Vassar' && idx.verified >= 0) {
      verified = String(cell(row, idx.verified)).toLowerCase() === 'true';
      if (verified) {
        audit = {
          allergens: Object.fromEntries(ALLERGEN_KEYS.map((k) => [k, 0])),
          voluntary_disclaimers: cell(row, idx.voluntary) || null,
          reviewed_by: cell(row, idx.reviewed_by) || null,
          date_reviewed: cell(row, idx.date_reviewed) || null,
        };
        for (const [hdr, key] of Object.entries(VASSAR_ALLERGEN)) {
          const ci = col(hdr);
          if (ci >= 0 && String(cell(row, ci)).toLowerCase() === 'true') audit.allergens[key] = 1;
        }
      }
    }

    const item = {
      unit_name: name, compass_id: null,
      storage_location: classification || 'Unassigned',
      item_description: description, brand: cell(row, idx.brand),
      distributor: cell(row, idx.distributor), distributor_sku: sku, gtin,
      manufacturer: cell(row, idx.mfg),
      audit_scope: reason === null, scope_reason: reason, qty_total: qty,
      audit_status: verified ? 'complete' : 'pending',
    };
    const prev = byKey.get(sku);
    if (!prev) { byKey.set(sku, item); if (audit) auditByKey.set(sku, audit); }
    else { duplicates++; if (betterRow(item, prev)) { byKey.set(sku, item); if (audit) auditByKey.set(sku, audit); } }
  }
  return { items: [...byKey.values()], auditByKey, skipped, duplicates };
}

// Orphans: PHOTO | INGREDIENTS | NUTRITIONAL INFORMATION | Seq | Item Description | Brand | Distributor | Dist #
function parseOrphans() {
  const rows = sheetRows('Orphans');
  const col = colMap(rows[0]);
  const idx = { seq: col('seq'), description: col('item description'), brand: col('brand'), distributor: col('distributor'), dist_num: col('dist #') };
  const cell = (row, i) => (i >= 0 ? norm(row[i]) : '');
  const byKey = new Map();
  let skipped = 0, duplicates = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const description = cell(row, idx.description);
    if (!description) { skipped++; continue; }
    const sku = skuFor({ distNum: cell(row, idx.dist_num), seq: cell(row, idx.seq), description });
    // No classification/category/qty columns -> qty null means no zero-exclusion.
    const reason = scopeReason({ description, clsTop: '', category: '', qty: null });
    const item = {
      unit_name: 'Orphans', compass_id: null, storage_location: 'Unassigned',
      item_description: description, brand: cell(row, idx.brand),
      distributor: cell(row, idx.distributor), distributor_sku: sku, gtin: null,
      manufacturer: '', audit_scope: reason === null, scope_reason: reason, qty_total: null,
      audit_status: 'pending',
    };
    const prev = byKey.get(sku);
    if (!prev) byKey.set(sku, item);
    else { duplicates++; if (betterRow(item, prev)) byKey.set(sku, item); }
  }
  return { items: [...byKey.values()], auditByKey: new Map(), skipped, duplicates };
}

// --- build everything --------------------------------------------------------
const units = [...STD, 'Orphans'];
const parsed = {};
for (const name of STD) parsed[name] = parseStandard(name);
parsed.Orphans = parseOrphans();

let allItems = [], totalAudits = 0;
console.log('\nUNIT       rows  inScope  outScope  dupes  audits   (out-of-scope buckets)');
for (const name of units) {
  const { items, auditByKey, skipped, duplicates } = parsed[name];
  const inScope = items.filter((i) => i.audit_scope).length;
  const out = items.length - inScope;
  const buckets = {};
  for (const it of items) if (it.scope_reason) buckets[it.scope_reason] = (buckets[it.scope_reason] || 0) + 1;
  totalAudits += auditByKey.size;
  allItems = allItems.concat(items);
  console.log(
    name.padEnd(10),
    String(items.length).padStart(4),
    String(inScope).padStart(8),
    String(out).padStart(9),
    String(duplicates).padStart(6),
    String(auditByKey.size).padStart(7),
    '  ', JSON.stringify(buckets), skipped ? `(skipped ${skipped})` : '',
  );
}
console.log('-'.repeat(72));
console.log('TOTAL'.padEnd(10), String(allItems.length).padStart(4), 'products,', totalAudits, 'audit records across', units.length, 'units');

if (!APPLY) {
  console.log('\nDRY RUN — no cloud changes. Re-run with APPLY=1 to wipe and load.');
  process.exit(0);
}

// --- apply to Supabase -------------------------------------------------------
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const die = (label, error) => { if (error) { console.error(`\n${label} FAILED:`, error.message || error); process.exit(1); } };

console.log('\nWiping cloud (audits, photos, products, units)...');
die('delete audits', (await sb.from('audits').delete().neq('product_id', -1)).error);
die('delete photos', (await sb.from('photos').delete().neq('product_id', -1)).error);
die('delete products', (await sb.from('products').delete().neq('id', -1)).error);
die('delete units', (await sb.from('units').delete().neq('unit_name', ' __never__')).error);

console.log('Inserting units...');
die('upsert units', (await sb.from('units').upsert(units.map((u) => ({ unit_name: u, compass_id: null })), { onConflict: 'unit_name' })).error);

console.log(`Inserting ${allItems.length} products...`);
const cloudRows = allItems.map((p) => ({
  unit_name: p.unit_name, compass_id: p.compass_id, storage_location: p.storage_location,
  item_description: p.item_description, brand: p.brand || null, distributor: p.distributor || null,
  distributor_sku: p.distributor_sku, gtin: p.gtin, manufacturer: p.manufacturer || null,
  audit_scope: !!p.audit_scope, audit_status: p.audit_status, scope_reason: p.scope_reason,
  qty_total: p.qty_total, gtin_prefill: null, removed: false,
}));
for (const batch of chunked(cloudRows)) die('upsert products', (await sb.from('products').upsert(batch, { onConflict: 'unit_name,distributor_sku' })).error);

// Map (unit_name, distributor_sku) -> cloud product id for the Vassar audits.
console.log('Mapping product ids for audit records...');
const { data: cloudProds, error: selErr } = await sb.from('products').select('id,unit_name,distributor_sku');
die('select products', selErr);
const idByKey = new Map(cloudProds.map((c) => [`${c.unit_name} ${c.distributor_sku}`, c.id]));

const auditRows = [];
for (const name of STD) {
  for (const [sku, a] of parsed[name].auditByKey) {
    const id = idByKey.get(`${name} ${sku}`);
    if (id == null) continue;
    auditRows.push({
      product_id: id, vendor_type: null, ingredients: null,
      voluntary_disclaimers: a.voluntary_disclaimers, allergen_other: null,
      ask_us_flag: false, reviewed_by: a.reviewed_by, date_reviewed: a.date_reviewed,
      review_due: null, gtin_prefill_used: false,
      notes: 'Allergen verification imported from Visual Ingredient Book (Verified = TRUE).',
      ...Object.fromEntries(ALLERGEN_KEYS.map((k) => [`allergen_${k}`, !!a.allergens[k]])),
    });
  }
}
if (auditRows.length) {
  console.log(`Inserting ${auditRows.length} audit records...`);
  for (const batch of chunked(auditRows)) die('upsert audits', (await sb.from('audits').upsert(batch, { onConflict: 'product_id' })).error);
}

// --- verify ------------------------------------------------------------------
const countOf = async (tbl) => { const { count, error } = await sb.from(tbl).select('*', { count: 'exact', head: true }); die(`count ${tbl}`, error); return count; };
console.log('\nVerify — cloud row counts:');
console.log('  units   :', await countOf('units'));
console.log('  products:', await countOf('products'));
console.log('  audits  :', await countOf('audits'));
console.log('  photos  :', await countOf('photos'));
console.log('\nDone.');
