const express = require('express');
const db = require('../db');
const { ALLERGEN_KEYS } = require('../allergens');
const { photoUpload, toWebPath } = require('../uploads');

const router = express.Router();

const ASK_US_VENDOR_TYPES = new Set(['House-Made', 'Local Artisan', 'Imported - Non-English Label']);

// ---- Units --------------------------------------------------------------
router.get('/units', (req, res) => {
  const rows = db.prepare(`
    SELECT unit_name, MAX(compass_id) AS compass_id, COUNT(*) AS total_products
    FROM products
    GROUP BY unit_name
    ORDER BY unit_name
  `).all();
  res.json(rows);
});

// ---- Locations (for a unit) with completion counts ----------------------
router.get('/locations', (req, res) => {
  const { unit } = req.query;
  if (!unit) return res.status(400).json({ error: 'unit query param is required' });
  const rows = db.prepare(`
    SELECT
      p.storage_location AS storage_location,
      COUNT(*) AS total,
      SUM(CASE WHEN p.audit_status = 'complete' THEN 1 ELSE 0 END) AS reviewed
    FROM products p
    WHERE p.unit_name = ? AND p.audit_scope = 1
    GROUP BY p.storage_location
    ORDER BY p.storage_location
  `).all(unit);
  res.json(rows);
});

// ---- Item list for a unit + location ------------------------------------
router.get('/products', (req, res) => {
  const { unit, location, search, allergen } = req.query;
  if (!unit) return res.status(400).json({ error: 'unit query param is required' });

  const where = ['p.unit_name = ?', 'p.audit_scope = 1'];
  const params = [unit];
  if (location) { where.push('p.storage_location = ?'); params.push(location); }
  if (search) {
    where.push('(p.item_description LIKE ? OR p.brand LIKE ? OR p.gtin LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (allergen && ALLERGEN_KEYS.includes(allergen)) {
    where.push(`a.allergen_${allergen} = 1`);
  }

  const rows = db.prepare(`
    SELECT
      p.id, p.item_description, p.brand, p.gtin, p.distributor_sku,
      p.storage_location, p.audit_status,
      (p.gtin_prefill IS NOT NULL) AS has_prefill,
      a.ask_us_flag AS ask_us_flag
    FROM products p
    LEFT JOIN audit_records a ON a.product_id = p.id
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE p.audit_status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
      p.item_description
  `).all(...params);
  res.json(rows);
});

// ---- Single product + its audit record + prefill ------------------------
router.get('/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const audit = db.prepare('SELECT * FROM audit_records WHERE product_id = ?').get(product.id);
  let prefill = null;
  if (product.gtin_prefill) {
    try { prefill = JSON.parse(product.gtin_prefill); } catch { prefill = null; }
  }
  res.json({ product: { ...product, gtin_prefill: undefined }, audit: audit || null, prefill });
});

// ---- Save audit record (create or update) -------------------------------
router.post('/products/:id/audit', photoUpload.single('label_photo'), (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const b = req.body;
  const bool = (v) => (v === true || v === 'true' || v === '1' || v === 1 ? 1 : 0);

  // ask_us_flag: auto-true for certain vendor types unless explicitly overridden.
  let askUs;
  if (b.ask_us_flag !== undefined && b.ask_us_flag !== '') {
    askUs = bool(b.ask_us_flag);
  } else {
    askUs = ASK_US_VENDOR_TYPES.has(b.vendor_type) ? 1 : 0;
  }

  // 'complete' (default) finalizes the audit; 'in_progress' saves a draft.
  const status = b.status === 'in_progress' ? 'in_progress' : 'complete';
  if (status === 'complete') {
    if (!b.vendor_type) {
      return res.status(400).json({ error: 'Vendor type is required to complete an audit.' });
    }
    if (!b.ingredients || !String(b.ingredients).trim()) {
      return res.status(400).json({ error: 'Ingredients are required to complete an audit.' });
    }
  }

  const existing = db.prepare('SELECT * FROM audit_records WHERE product_id = ?').get(product.id);

  // Photo path: new upload wins; otherwise keep prior photo.
  let photoWeb = existing ? existing.label_photo_path : null;
  if (req.file) photoWeb = toWebPath(req.file.path);

  // Review dates only exist once an audit is signed off.
  let today = null, reviewDue = null;
  if (status === 'complete') {
    today = new Date().toISOString().slice(0, 10);
    const due = new Date();
    due.setDate(due.getDate() + 90);
    reviewDue = due.toISOString().slice(0, 10);
  }

  const prefillUsed = bool(b.gtin_prefill_used);

  const record = {
    product_id: product.id,
    vendor_type: b.vendor_type || null,
    ingredients: b.ingredients || null,
    voluntary_disclaimers: b.voluntary_disclaimers || null,
    allergen_milk: bool(b.allergen_milk),
    allergen_eggs: bool(b.allergen_eggs),
    allergen_fish: bool(b.allergen_fish),
    allergen_shellfish: bool(b.allergen_shellfish),
    allergen_tree_nuts: bool(b.allergen_tree_nuts),
    allergen_peanuts: bool(b.allergen_peanuts),
    allergen_wheat: bool(b.allergen_wheat),
    allergen_soybeans: bool(b.allergen_soybeans),
    allergen_sesame: bool(b.allergen_sesame),
    allergen_gluten: bool(b.allergen_gluten),
    allergen_other: b.allergen_other || null,
    ask_us_flag: askUs,
    label_photo_path: photoWeb,
    reviewed_by: b.reviewed_by || (existing ? existing.reviewed_by : null),
    date_reviewed: today,
    review_due: reviewDue,
    gtin_prefill_used: prefillUsed,
    notes: b.notes || null,
  };

  const tx = db.transaction(() => {
    if (existing) {
      db.prepare(`
        UPDATE audit_records SET
          vendor_type=@vendor_type, ingredients=@ingredients,
          voluntary_disclaimers=@voluntary_disclaimers,
          allergen_milk=@allergen_milk, allergen_eggs=@allergen_eggs,
          allergen_fish=@allergen_fish, allergen_shellfish=@allergen_shellfish,
          allergen_tree_nuts=@allergen_tree_nuts, allergen_peanuts=@allergen_peanuts,
          allergen_wheat=@allergen_wheat, allergen_soybeans=@allergen_soybeans,
          allergen_sesame=@allergen_sesame, allergen_gluten=@allergen_gluten,
          allergen_other=@allergen_other, ask_us_flag=@ask_us_flag,
          label_photo_path=@label_photo_path, reviewed_by=@reviewed_by,
          date_reviewed=@date_reviewed, review_due=@review_due,
          gtin_prefill_used=@gtin_prefill_used, notes=@notes
        WHERE product_id=@product_id
      `).run(record);
    } else {
      db.prepare(`
        INSERT INTO audit_records
          (product_id, vendor_type, ingredients, voluntary_disclaimers,
           allergen_milk, allergen_eggs, allergen_fish, allergen_shellfish,
           allergen_tree_nuts, allergen_peanuts, allergen_wheat, allergen_soybeans,
           allergen_sesame, allergen_gluten, allergen_other, ask_us_flag,
           label_photo_path, reviewed_by, date_reviewed, review_due,
           gtin_prefill_used, notes)
        VALUES
          (@product_id, @vendor_type, @ingredients, @voluntary_disclaimers,
           @allergen_milk, @allergen_eggs, @allergen_fish, @allergen_shellfish,
           @allergen_tree_nuts, @allergen_peanuts, @allergen_wheat, @allergen_soybeans,
           @allergen_sesame, @allergen_gluten, @allergen_other, @ask_us_flag,
           @label_photo_path, @reviewed_by, @date_reviewed, @review_due,
           @gtin_prefill_used, @notes)
      `).run(record);
    }
    db.prepare('UPDATE products SET audit_status = ? WHERE id = ?').run(status, product.id);
  });
  tx();

  res.json({ ok: true, product_id: product.id, status, label_photo_path: photoWeb });
});

// ---- Compliance summary -------------------------------------------------
router.get('/compliance', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const summary = db.prepare(`
    SELECT
      unit_name,
      MAX(compass_id) AS compass_id,
      COUNT(*) AS total,
      SUM(CASE WHEN audit_status = 'complete' THEN 1 ELSE 0 END) AS complete,
      SUM(CASE WHEN audit_status != 'complete' THEN 1 ELSE 0 END) AS pending
    FROM products
    WHERE audit_scope = 1
    GROUP BY unit_name
    ORDER BY unit_name
  `).all().map((r) => ({
    ...r,
    pct_complete: r.total ? Math.round((r.complete / r.total) * 100) : 0,
  }));

  const overdue = db.prepare(`
    SELECT p.unit_name, p.storage_location, p.item_description, p.brand,
           a.review_due, a.reviewed_by
    FROM audit_records a
    JOIN products p ON p.id = a.product_id
    WHERE a.review_due IS NOT NULL AND a.review_due < ?
    ORDER BY a.review_due ASC
  `).all(today);

  const askUs = db.prepare(`
    SELECT p.unit_name, p.storage_location, p.item_description, p.brand,
           a.vendor_type, a.review_due
    FROM audit_records a
    JOIN products p ON p.id = a.product_id
    WHERE a.ask_us_flag = 1
    ORDER BY p.unit_name, p.item_description
  `).all();

  res.json({ summary, overdue, askUs });
});

module.exports = router;
