import React, { useState } from 'react';
import { api } from '../api';

export default function ImportScreen() {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [restoreMsg, setRestoreMsg] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setResult(null);
    if (!file) return setErr('Choose a CSV or Excel file to upload.');
    setBusy(true);
    try {
      const r = await api.importFile(file);
      setResult(r);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const onRestore = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!window.confirm('Restoring replaces ALL products and audit records on this device with the backup contents. Continue?')) return;
    setRestoreMsg(''); setErr('');
    try {
      const r = await api.restoreBackup(f);
      setRestoreMsg(`Restored ${r.products} products and ${r.audits} audit records.`);
    } catch (e2) {
      setErr(e2.message);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Import Inventory</h1>
          <p className="muted">Load a MyOrders inventory export (.csv or .xlsx)</p>
        </div>
      </div>

      <div className="card">
        <p className="muted">
          The unit name and COMPASS ID are read from the file header (e.g.
          <code> MIT Forbes Family Cafe (COMPASS-44873)</code>). Products are matched on
          unit&nbsp;+&nbsp;distributor SKU — existing audit records are never overwritten.
          Non-food rooms (Paper, Chemical, Cleaning, DO NOT INVENTORY) and single-ingredient
          produce are automatically marked out of audit scope.
        </p>

        <form onSubmit={submit} className="import-form">
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files[0] || null)}
          />
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </form>

        {err && <div className="alert alert-error">{err}</div>}

        {result && (
          <div className="alert alert-success">
            <strong>Import complete — {result.unit_name} ({result.compass_id})</strong>
            <ul className="result-list">
              <li><strong>{result.inserted + result.updated - result.out_of_scope} food products in audit scope</strong> ({result.inserted} new, {result.updated} updated)</li>
              {result.buckets?.non_food > 0 && <li>{result.buckets.non_food} non-food items excluded</li>}
              {result.buckets?.do_not_inventory > 0 && <li>{result.buckets.do_not_inventory} marked "do not inventory"</li>}
              {result.buckets?.zero_qty > 0 && <li>{result.buckets.zero_qty} zero-quantity items excluded</li>}
              {result.buckets?.single_ingredient > 0 && <li>{result.buckets.single_ingredient} single-ingredient staples excluded</li>}
              {result.duplicates > 0 && <li>{result.duplicates} duplicate SKU rows collapsed</li>}
              {result.skipped > 0 && <li>{result.skipped} rows skipped (no item description)</li>}
            </ul>
            <p className="muted small">
              Ingredient prefill from Open Food Facts is loading in the background for items with a GTIN.
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Backup &amp; Restore</h3>
        <p className="muted">
          All audit data lives on <strong>this device</strong>. Download a backup regularly —
          clearing browser data erases everything. Backups include products and audit records
          (label photos stay on the device only).
        </p>
        <div className="import-form">
          <button type="button" className="btn btn-ghost" onClick={() => api.downloadBackup()}>
            ⬇ Download backup
          </button>
          <label className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
            ⬆ Restore from backup
            <input type="file" accept=".json,application/json" onChange={onRestore} style={{ display: 'none' }} />
          </label>
        </div>
        {restoreMsg && <div className="alert alert-success">{restoreMsg}</div>}
      </div>
    </div>
  );
}
