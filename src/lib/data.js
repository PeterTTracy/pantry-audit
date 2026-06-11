// On-device data layer: everything the Express server used to do, now backed
// by IndexedDB in the browser. Function shapes mirror the old REST responses
// so the pages stay unchanged.
import * as XLSX from 'xlsx';
import { tx, reqp } from './idb';
import { parseImportRows } from './importParse';
import { computeCompliance } from './compliance';
import { buildExportSheets } from './exportRows';
import { fetchPrefill } from './off';
import { sync } from './sync';

const ASK_US_VENDOR_TYPES = new Set(['House-Made', 'Local Artisan', 'Imported - Non-English Label']);
const ALLERGEN_KEYS = [
  'milk', 'eggs', 'fish', 'shellfish', 'tree_nuts',
  'peanuts', 'wheat', 'soybeans', 'sesame', 'gluten',
];

const todayISO = () => new Date().toISOString().slice(0, 10);
const plusDaysISO = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const bool = (v) => (v === true || v === 'true' || v === '1' || v === 1 ? 1 : 0);

// ---- Units / houses ---------------------------------------------------------
export async function listUnits() {
  const [unitRows, products] = await tx(['units', 'products'], 'readonly', async (t) => [
    await reqp(t.objectStore('units').getAll()),
    await reqp(t.objectStore('products').getAll()),
  ]);
  const byUnit = new Map(unitRows.map((u) => [
    u.unit_name, { unit_name: u.unit_name, compass_id: u.compass_id || null, total_products: 0 },
  ]));
  for (const p of products) {
    let u = byUnit.get(p.unit_name);
    if (!u) { u = { unit_name: p.unit_name, compass_id: null, total_products: 0 }; byUnit.set(p.unit_name, u); }
    if (p.compass_id) u.compass_id = p.compass_id;
    if (!p.removed) u.total_products++;
  }
  return [...byUnit.values()].sort((a, b) => a.unit_name.localeCompare(b.unit_name));
}

export async function addUnit(unitName, compassId) {
  const name = String(unitName || '').trim();
  if (!name) throw new Error('House name is required.');
  let compass = String(compassId || '').trim().toUpperCase() || null;
  if (compass && /^\d+$/.test(compass)) compass = `COMPASS-${compass}`;
  return tx(['units'], 'readwrite', async (t) => {
    const existing = await reqp(t.objectStore('units').get(name));
    if (existing) throw new Error(`"${name}" already exists.`);
    await reqp(t.objectStore('units').add({ unit_name: name, compass_id: compass }));
    return { unit_name: name, compass_id: compass };
  }).then((r) => { sync.unit(name); return r; });
}

// Permanently deletes the unit and ALL of its products, audits, and photos.
export async function deleteUnit(unitName) {
  return tx(['units', 'products', 'audits', 'photos'], 'readwrite', async (t) => {
    await reqp(t.objectStore('units').delete(unitName));
    const prods = await reqp(t.objectStore('products').index('unit_name').getAll(IDBKeyRange.only(unitName)));
    for (const p of prods) {
      await reqp(t.objectStore('products').delete(p.id));
      await reqp(t.objectStore('audits').delete(p.id));
      await reqp(t.objectStore('photos').delete(p.id));
    }
    return { deleted_products: prods.length };
  }).then((r) => { sync.deleteUnit(unitName); return r; });
}

// Per-unit stats for the Settings screen.
export async function unitStats() {
  const units = await listUnits();
  const products = await tx(['products'], 'readonly', (t) => reqp(t.objectStore('products').getAll()));
  const stats = new Map(units.map((u) => [u.unit_name, { ...u, in_scope: 0, complete: 0, removed: 0 }]));
  for (const p of products) {
    const s = stats.get(p.unit_name);
    if (!s) continue;
    if (p.removed) { s.removed++; continue; }
    if (p.audit_scope === 1) {
      s.in_scope++;
      if (p.audit_status === 'complete') s.complete++;
    }
  }
  return [...stats.values()];
}

// ---- Locations (for a unit) with completion counts -------------------------
export async function listLocations(unit) {
  const products = await unitProducts(unit);
  const byLoc = new Map();
  for (const p of products) {
    if (p.audit_scope !== 1 || p.removed) continue;
    let l = byLoc.get(p.storage_location);
    if (!l) { l = { storage_location: p.storage_location, total: 0, reviewed: 0 }; byLoc.set(p.storage_location, l); }
    l.total++;
    if (p.audit_status === 'complete') l.reviewed++;
  }
  return [...byLoc.values()].sort((a, b) => String(a.storage_location).localeCompare(String(b.storage_location)));
}

async function unitProducts(unit) {
  return tx(['products'], 'readonly', (t) =>
    reqp(t.objectStore('products').index('unit_name').getAll(IDBKeyRange.only(unit))));
}

// ---- Item list for a unit + location ---------------------------------------
const STATUS_ORDER = { pending: 0, in_progress: 1, complete: 2 };

export async function listProducts({ unit, location, search, allergen }) {
  const [products, audits] = await tx(['products', 'audits'], 'readonly', async (t) => [
    await reqp(t.objectStore('products').index('unit_name').getAll(IDBKeyRange.only(unit))),
    await reqp(t.objectStore('audits').getAll()),
  ]);
  const auditByProduct = new Map(audits.map((a) => [a.product_id, a]));
  const q = (search || '').toLowerCase();

  return products
    .filter((p) => p.audit_scope === 1 && !p.removed)
    .filter((p) => !location || p.storage_location === location)
    .filter((p) => !q ||
      String(p.item_description || '').toLowerCase().includes(q) ||
      String(p.brand || '').toLowerCase().includes(q) ||
      String(p.gtin || '').toLowerCase().includes(q))
    .filter((p) => {
      if (!allergen || !ALLERGEN_KEYS.includes(allergen)) return true;
      const a = auditByProduct.get(p.id);
      return a && a[`allergen_${allergen}`] === 1;
    })
    .map((p) => ({
      id: p.id,
      item_description: p.item_description,
      brand: p.brand,
      gtin: p.gtin,
      distributor_sku: p.distributor_sku,
      storage_location: p.storage_location,
      audit_status: p.audit_status,
      has_prefill: p.gtin_prefill ? 1 : 0,
      ask_us_flag: auditByProduct.get(p.id)?.ask_us_flag ?? null,
    }))
    .sort((a, b) =>
      (STATUS_ORDER[a.audit_status] ?? 3) - (STATUS_ORDER[b.audit_status] ?? 3) ||
      String(a.item_description).localeCompare(String(b.item_description)));
}

// ---- Single product + audit + prefill + photo ------------------------------
export async function getProduct(id) {
  const pid = Number(id);
  const [product, audit, photo] = await tx(['products', 'audits', 'photos'], 'readonly', async (t) => [
    await reqp(t.objectStore('products').get(pid)),
    await reqp(t.objectStore('audits').get(pid)),
    await reqp(t.objectStore('photos').get(pid)),
  ]);
  if (!product) throw new Error('Product not found');

  // Fetch prefill on demand if we never got it (e.g. imported offline).
  let prefill = product.gtin_prefill || null;
  if (!prefill && product.gtin && product.audit_status === 'pending') {
    prefill = await fetchPrefill(product.gtin);
    if (prefill) {
      await tx(['products'], 'readwrite', (t) =>
        reqp(t.objectStore('products').put({ ...product, gtin_prefill: prefill })));
    }
  }

  const { gtin_prefill, ...productOut } = product;
  return {
    product: productOut,
    audit: audit || null,
    prefill,
    photoUrl: photo ? URL.createObjectURL(photo.blob) : null,
    photoName: photo ? photo.name : null,
  };
}

// ---- Save audit record (draft or complete) ----------------------------------
export async function saveAudit(id, fields, photoFile) {
  const pid = Number(id);
  const status = fields.status === 'in_progress' ? 'in_progress' : 'complete';
  if (status === 'complete') {
    if (!fields.vendor_type) throw new Error('Vendor type is required to complete an audit.');
    if (!fields.ingredients || !String(fields.ingredients).trim()) {
      throw new Error('Ingredients are required to complete an audit.');
    }
  }

  return tx(['products', 'audits', 'photos'], 'readwrite', async (t) => {
    const product = await reqp(t.objectStore('products').get(pid));
    if (!product) throw new Error('Product not found');
    const existing = await reqp(t.objectStore('audits').get(pid));

    let askUs;
    if (fields.ask_us_flag !== undefined && fields.ask_us_flag !== '') {
      askUs = bool(fields.ask_us_flag);
    } else {
      askUs = ASK_US_VENDOR_TYPES.has(fields.vendor_type) ? 1 : 0;
    }

    const record = {
      product_id: pid,
      vendor_type: fields.vendor_type || null,
      ingredients: fields.ingredients || null,
      voluntary_disclaimers: fields.voluntary_disclaimers || null,
      ...Object.fromEntries(ALLERGEN_KEYS.map((k) => [`allergen_${k}`, bool(fields[`allergen_${k}`])])),
      allergen_other: fields.allergen_other || null,
      ask_us_flag: askUs,
      reviewed_by: fields.reviewed_by || (existing ? existing.reviewed_by : null),
      date_reviewed: status === 'complete' ? todayISO() : null,
      review_due: status === 'complete' ? plusDaysISO(90) : null,
      gtin_prefill_used: bool(fields.gtin_prefill_used),
      notes: fields.notes || null,
    };

    await reqp(t.objectStore('audits').put(record));
    await reqp(t.objectStore('products').put({ ...product, audit_status: status }));
    if (photoFile) {
      await reqp(t.objectStore('photos').put({ product_id: pid, name: photoFile.name, blob: photoFile }));
    }
    return { ok: true, product_id: pid, status };
  }).then((r) => { sync.audit(pid); return r; });
}

// ---- Remove / restore items from the audit list -------------------------------
// "Removed" excludes an item from lists, compliance, and export without
// deleting its data; re-imports won't resurrect it. Restorable in Settings.
export async function removeFromAudit(id) {
  const pid = Number(id);
  return tx(['products'], 'readwrite', async (t) => {
    const p = await reqp(t.objectStore('products').get(pid));
    if (!p) throw new Error('Product not found');
    await reqp(t.objectStore('products').put({ ...p, removed: 1 }));
    return { ok: true };
  }).then((r) => { sync.product(pid); return r; });
}

export async function restoreProduct(id) {
  const pid = Number(id);
  return tx(['products'], 'readwrite', async (t) => {
    const p = await reqp(t.objectStore('products').get(pid));
    if (!p) throw new Error('Product not found');
    await reqp(t.objectStore('products').put({ ...p, removed: 0 }));
    return { ok: true };
  }).then((r) => { sync.product(pid); return r; });
}

export async function restoreRemoved(unitName) {
  return tx(['products'], 'readwrite', async (t) => {
    const prods = await reqp(t.objectStore('products').index('unit_name').getAll(IDBKeyRange.only(unitName)));
    let restored = 0;
    for (const p of prods) {
      if (p.removed) {
        await reqp(t.objectStore('products').put({ ...p, removed: 0 }));
        restored++;
      }
    }
    return { restored };
  }).then((r) => { sync.unitProducts(unitName); return r; });
}

// ---- Import a MyOrders export ----------------------------------------------
export async function importFile(file) {
  const buf = await file.arrayBuffer();
  let rows;
  try {
    // raw: true keeps CSV cells as text so GTIN leading zeros survive.
    const wb = XLSX.read(buf, { type: 'array', raw: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
  } catch (err) {
    throw new Error(`Could not parse file: ${err.message}`);
  }

  const { unit, items, skipped, duplicates, buckets } = parseImportRows(rows);

  let inserted = 0, updated = 0, outOfScope = 0;
  await tx(['units', 'products'], 'readwrite', async (t) => {
    await reqp(t.objectStore('units').put({ unit_name: unit.unit_name, compass_id: unit.compass_id }));
    const store = t.objectStore('products');
    const bySku = store.index('unit_sku');
    for (const item of items) {
      const existing = await reqp(bySku.get(IDBKeyRange.only([item.unit_name, item.distributor_sku])));
      if (existing) {
        // audit_status, gtin_prefill, and removed are intentionally left untouched.
        await reqp(store.put({
          ...existing, ...item, id: existing.id,
          audit_status: existing.audit_status,
          gtin_prefill: existing.gtin_prefill,
          removed: existing.removed || 0,
        }));
        updated++;
      } else {
        await reqp(store.add({ ...item, audit_status: 'pending', gtin_prefill: null, removed: 0 }));
        inserted++;
      }
      if (!item.audit_scope) outOfScope++;
    }
  });

  // Push the imported unit + products to the cloud (background, best-effort).
  sync.unitProducts(unit.unit_name);

  // Open Food Facts prefill in the background; don't block the result.
  // Re-push once it settles so the fetched prefill reaches the cloud too.
  runPrefillForUnit(unit.unit_name)
    .then((n) => { if (n) sync.unitProducts(unit.unit_name); })
    .catch(() => {});

  return {
    ok: true,
    unit_name: unit.unit_name,
    compass_id: unit.compass_id,
    inserted, updated, skipped, duplicates, out_of_scope: outOfScope, buckets,
  };
}

async function runPrefillForUnit(unitName) {
  const products = await unitProducts(unitName);
  const pending = products.filter((p) =>
    p.audit_status === 'pending' && p.gtin && !p.gtin_prefill);
  let updated = 0;
  for (const p of pending) {
    const prefill = await fetchPrefill(p.gtin);
    if (prefill) {
      await tx(['products'], 'readwrite', async (t) => {
        const fresh = await reqp(t.objectStore('products').get(p.id));
        if (fresh && !fresh.gtin_prefill) {
          await reqp(t.objectStore('products').put({ ...fresh, gtin_prefill: prefill }));
          updated++;
        }
      });
    }
  }
  return updated;
}

// ---- Compliance summary -----------------------------------------------------
export async function compliance() {
  const [products, audits] = await tx(['products', 'audits'], 'readonly', async (t) => [
    await reqp(t.objectStore('products').getAll()),
    await reqp(t.objectStore('audits').getAll()),
  ]);
  return computeCompliance(products.filter((p) => !p.removed), audits, todayISO());
}

// ---- Export to .xlsx (browser download) --------------------------------------
export async function exportXlsx() {
  const [products, audits, photos] = await tx(['products', 'audits', 'photos'], 'readonly', async (t) => [
    await reqp(t.objectStore('products').getAll()),
    await reqp(t.objectStore('audits').getAll()),
    await reqp(t.objectStore('photos').getAll()),
  ]);
  const photoNames = new Map(photos.map((p) => [p.product_id, p.name]));

  const wb = XLSX.utils.book_new();
  for (const { sheet, rows } of buildExportSheets(products.filter((p) => !p.removed), audits, photoNames)) {
    const ws = rows.length
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([['No audit-scope items for this unit.']]);
    XLSX.utils.book_append_sheet(wb, ws, sheet);
  }
  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['No data']]), 'Empty');
  }
  XLSX.writeFile(wb, `pantry_audit_export_${todayISO()}.xlsx`);
}

// ---- Backup & restore (JSON, photos excluded) --------------------------------
export async function downloadBackup() {
  const [units, products, audits] = await tx(['units', 'products', 'audits'], 'readonly', async (t) => [
    await reqp(t.objectStore('units').getAll()),
    await reqp(t.objectStore('products').getAll()),
    await reqp(t.objectStore('audits').getAll()),
  ]);
  const payload = { app: 'pantry-audit', version: 2, exported_at: new Date().toISOString(), units, products, audits };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pantry_audit_backup_${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function restoreBackup(file) {
  let payload;
  try { payload = JSON.parse(await file.text()); }
  catch { throw new Error('Not a valid backup file (could not parse JSON).'); }
  if (payload.app !== 'pantry-audit' || !Array.isArray(payload.products) || !Array.isArray(payload.audits)) {
    throw new Error('Not a valid Pantry Audit backup file.');
  }
  // v1 backups have no units array; derive it from products.
  const units = Array.isArray(payload.units) ? payload.units : (() => {
    const seen = new Map();
    for (const p of payload.products) {
      if (!seen.has(p.unit_name)) seen.set(p.unit_name, { unit_name: p.unit_name, compass_id: p.compass_id || null });
    }
    return [...seen.values()];
  })();
  await tx(['units', 'products', 'audits'], 'readwrite', async (t) => {
    await reqp(t.objectStore('units').clear());
    await reqp(t.objectStore('products').clear());
    await reqp(t.objectStore('audits').clear());
    for (const u of units) await reqp(t.objectStore('units').put(u));
    for (const p of payload.products) await reqp(t.objectStore('products').put(p));
    for (const a of payload.audits) await reqp(t.objectStore('audits').put(a));
  });
  return { products: payload.products.length, audits: payload.audits.length };
}
