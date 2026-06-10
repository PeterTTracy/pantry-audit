const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3457;
// 127.0.0.1, not localhost: avoids resolving to another process bound on ::1.
const BASE = `http://127.0.0.1:${PORT}`;
const UNIT = 'Forbes Family Cafe';

let server;
let dataDir;

async function waitForHealth(tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Server did not become healthy in time.');
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantry-test-'));
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), PANTRY_DATA_DIR: dataDir },
    stdio: 'ignore',
  });
  await waitForHealth();
});

after(async () => {
  if (server) {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
  }
  // Best-effort: Windows may briefly hold the SQLite WAL file after exit.
  if (dataDir) {
    try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch { /* leftover temp dir is harmless */ }
  }
});

test('seeds sample unit on first run', async () => {
  const units = await (await fetch(`${BASE}/api/units`)).json();
  assert.ok(units.some((u) => u.unit_name === UNIT), 'seed unit present');
});

test('lists locations with completion counts', async () => {
  const locs = await (await fetch(`${BASE}/api/locations?unit=${encodeURIComponent(UNIT)}`)).json();
  assert.ok(locs.length >= 2, 'at least two storage locations');
  for (const l of locs) {
    assert.ok(typeof l.total === 'number' && typeof l.reviewed === 'number');
  }
});

test('rejects completing an audit without vendor type / ingredients', async () => {
  const fd = new FormData();
  fd.set('status', 'complete');
  fd.set('reviewed_by', 'Test');
  const res = await fetch(`${BASE}/api/products/1/audit`, { method: 'POST', body: fd });
  assert.strictEqual(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /vendor type/i);
});

test('save progress sets in_progress without review dates', async () => {
  const fd = new FormData();
  fd.set('status', 'in_progress');
  fd.set('notes', 'halfway through the label');
  fd.set('reviewed_by', 'Test');
  const res = await fetch(`${BASE}/api/products/1/audit`, { method: 'POST', body: fd });
  assert.strictEqual(res.status, 200);

  const detail = await (await fetch(`${BASE}/api/products/1`)).json();
  assert.strictEqual(detail.product.audit_status, 'in_progress');
  assert.strictEqual(detail.audit.date_reviewed, null);
  assert.strictEqual(detail.audit.review_due, null);
});

test('completing an audit sets status and +90 day review due', async () => {
  const fd = new FormData();
  fd.set('status', 'complete');
  fd.set('vendor_type', 'FDA Packaged');
  fd.set('ingredients', 'Enriched flour, vegetable oil, cheese.');
  fd.set('allergen_milk', '1');
  fd.set('allergen_wheat', '1');
  fd.set('reviewed_by', 'Test');
  const res = await fetch(`${BASE}/api/products/1/audit`, { method: 'POST', body: fd });
  assert.strictEqual(res.status, 200);

  const detail = await (await fetch(`${BASE}/api/products/1`)).json();
  assert.strictEqual(detail.product.audit_status, 'complete');
  assert.strictEqual(detail.audit.allergen_milk, 1);
  assert.ok(detail.audit.date_reviewed, 'date_reviewed set');
  assert.ok(detail.audit.review_due > detail.audit.date_reviewed, 'review_due after date_reviewed');
});

test('compliance summary reflects saved audits', async () => {
  const { summary, overdue, askUs } = await (await fetch(`${BASE}/api/compliance`)).json();
  const row = summary.find((s) => s.unit_name === UNIT);
  assert.ok(row && row.complete >= 1);
  assert.ok(Array.isArray(overdue) && Array.isArray(askUs));
});

test('imports the sample MyOrders CSV', async () => {
  const csv = fs.readFileSync(path.join(__dirname, '..', 'samples', 'sample_myorders_export.csv'));
  const fd = new FormData();
  fd.set('file', new Blob([csv], { type: 'text/csv' }), 'sample.csv');
  const res = await fetch(`${BASE}/api/import`, { method: 'POST', body: fd });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.inserted, 10);
  assert.strictEqual(body.out_of_scope, 4);
});

test('exports an xlsx workbook', async () => {
  const res = await fetch(`${BASE}/api/export`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 1000, 'workbook has content');
  assert.strictEqual(buf.toString('latin1', 0, 2), 'PK', 'xlsx is a zip container');
});
