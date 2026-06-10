// Pure compliance aggregation over in-memory products + audits.
// Mirrors what the SQL queries computed in the server version.

export function computeCompliance(products, audits, today) {
  const auditByProduct = new Map(audits.map((a) => [a.product_id, a]));
  const scope = products.filter((p) => p.audit_scope === 1);

  const byUnit = new Map();
  for (const p of scope) {
    let u = byUnit.get(p.unit_name);
    if (!u) {
      u = { unit_name: p.unit_name, compass_id: p.compass_id || null, total: 0, complete: 0, pending: 0 };
      byUnit.set(p.unit_name, u);
    }
    if (p.compass_id) u.compass_id = p.compass_id;
    u.total++;
    if (p.audit_status === 'complete') u.complete++;
    else u.pending++;
  }
  const summary = [...byUnit.values()]
    .sort((a, b) => a.unit_name.localeCompare(b.unit_name))
    .map((u) => ({ ...u, pct_complete: u.total ? Math.round((u.complete / u.total) * 100) : 0 }));

  const joined = (pred) => products
    .filter((p) => {
      const a = auditByProduct.get(p.id);
      return a && pred(a);
    })
    .map((p) => ({ p, a: auditByProduct.get(p.id) }));

  const overdue = joined((a) => a.review_due && a.review_due < today)
    .sort((x, y) => x.a.review_due.localeCompare(y.a.review_due))
    .map(({ p, a }) => ({
      unit_name: p.unit_name, storage_location: p.storage_location,
      item_description: p.item_description, brand: p.brand,
      review_due: a.review_due, reviewed_by: a.reviewed_by,
    }));

  const askUs = joined((a) => a.ask_us_flag === 1)
    .sort((x, y) =>
      x.p.unit_name.localeCompare(y.p.unit_name) ||
      x.p.item_description.localeCompare(y.p.item_description))
    .map(({ p, a }) => ({
      unit_name: p.unit_name, storage_location: p.storage_location,
      item_description: p.item_description, brand: p.brand,
      vendor_type: a.vendor_type, review_due: a.review_due,
    }));

  return { summary, overdue, askUs };
}
